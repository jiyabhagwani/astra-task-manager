require("dotenv").config();

const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");
const path = require("path");

const app = express();

/* =========================
   APP CONFIG
========================= */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   ENV VALIDATION
========================= */
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it in Railway Variables.");
}

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET missing. Using fallback secret (not recommended for production).");
}

/* =========================
   DATABASE CONFIG (RAILWAY SAFE)
========================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

console.log("Connecting to Railway PostgreSQL...");

pool.connect((err, client, release) => {
  if (err) {
    console.error("DATABASE CONNECTION FAILED:", err.message);
  } else {
    console.log("DATABASE CONNECTED SUCCESSFULLY");
    release();
  }
});

/* =========================
   INIT DATABASE
========================= */
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'member'
      );

      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_members (
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (project_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        priority TEXT DEFAULT 'medium',
        due_date TEXT,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        assigned_to INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    console.log("DATABASE TABLES READY");
  } catch (err) {
    console.error("DATABASE INIT ERROR:", err.message);
  }
}

initDB();

/* =========================
   HELPERS
========================= */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

function authMiddleware(req, res, next) {
  const token = req.cookies.token;

  if (!token) return res.redirect("/login");

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret");
    next();
  } catch {
    return res.redirect("/login");
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== "admin") {
    return res.send("Admin access only.");
  }
  next();
}

/* =========================
   ROUTES
========================= */
app.get("/", (req, res) => {
  res.render("landing");
});

/* ---------- AUTH ---------- */
app.get("/signup", (req, res) => {
  res.render("signup");
});

app.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.send("All fields are required.");
  }

  try {
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.send("User already exists.");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // First user becomes admin automatically
    const userCount = await pool.query("SELECT COUNT(*) FROM users");
    const role = parseInt(userCount.rows[0].count) === 0 ? "admin" : "member";

    await pool.query(
      "INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4)",
      [username, email, hashedPassword, role]
    );

    console.log(`Signup successful: ${email}`);
    res.redirect("/login");
  } catch (err) {
    console.error("SIGNUP ERROR:", err.message);
    res.send("Signup failed: " + err.message);
  }
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    const user = result.rows[0];

    if (!user) return res.send("User not found.");

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) return res.send("Invalid password.");

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
      },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });

    console.log(`Login successful: ${email}`);
    res.redirect("/dashboard");
  } catch (err) {
    console.error("LOGIN ERROR:", err.message);
    res.send("Login failed: " + err.message);
  }
});

/* ---------- DASHBOARD ---------- */
app.get("/dashboard", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const greeting = getGreeting();
    const isAdmin = user.role === "admin";

    let projectsResult;
    let tasksResult;
    let usersResult = { rows: [] };

    if (isAdmin) {
      projectsResult = await pool.query("SELECT * FROM projects");

      tasksResult = await pool.query(`
        SELECT t.*, 
               p.name AS project_name,
               u.username AS assigned_to_name
        FROM tasks t
        LEFT JOIN projects p ON t.project_id = p.id
        LEFT JOIN users u ON t.assigned_to = u.id
      `);

      usersResult = await pool.query(
        "SELECT id, username, email, role FROM users"
      );
    } else {
      projectsResult = await pool.query(`
        SELECT p.*
        FROM projects p
        JOIN project_members pm ON p.id = pm.project_id
        WHERE pm.user_id = $1
      `, [user.id]);

      tasksResult = await pool.query(`
        SELECT t.*, 
               p.name AS project_name,
               u.username AS assigned_to_name
        FROM tasks t
        LEFT JOIN projects p ON t.project_id = p.id
        LEFT JOIN users u ON t.assigned_to = u.id
        WHERE t.assigned_to = $1
      `, [user.id]);
    }

    const overdue = tasksResult.rows.filter(
      task =>
        task.due_date &&
        new Date(task.due_date) < new Date() &&
        task.status !== "done"
    );

    const totalTasks = tasksResult.rows.length;
    const completedTasks = tasksResult.rows.filter(
      task => task.status === "done"
    ).length;

    const productivityScore =
      totalTasks === 0
        ? 0
        : Math.round((completedTasks / totalTasks) * 100);

    res.render("dashboard", {
      user,
      projects: projectsResult.rows,
      tasks: tasksResult.rows,
      overdue,
      isAdmin,
      allUsers: usersResult.rows,
      greeting,
      productivityScore,
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err.message);
    res.redirect("/login");
  }
});

/* ---------- PROJECTS ---------- */
app.post("/projects", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) return res.send("Project name required.");

    const result = await pool.query(
      "INSERT INTO projects (name, created_by) VALUES ($1, $2) RETURNING id",
      [name, req.user.id]
    );

    await pool.query(
      "INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)",
      [result.rows[0].id, req.user.id]
    );

    res.redirect("/dashboard");
  } catch (err) {
    console.error("PROJECT ERROR:", err.message);
    res.send("Project creation failed.");
  }
});

/* ---------- TASKS ---------- */
app.post("/tasks", authMiddleware, async (req, res) => {
  try {
    const { title, description, due_date, assigned_to, project_id, priority } =
      req.body;

    if (!title) return res.send("Task title required.");

    await pool.query(
      `INSERT INTO tasks 
       (title, description, due_date, assigned_to, project_id, created_by, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        title,
        description,
        due_date,
        assigned_to || req.user.id,
        project_id,
        req.user.id,
        priority || "medium",
      ]
    );

    res.redirect("/dashboard");
  } catch (err) {
    console.error("TASK ERROR:", err.message);
    res.send("Task creation failed.");
  }
});

app.post("/tasks/:id/status", authMiddleware, async (req, res) => {
  try {
    const taskResult = await pool.query(
      "SELECT * FROM tasks WHERE id = $1",
      [req.params.id]
    );

    const task = taskResult.rows[0];

    if (
      req.user.role !== "admin" &&
      task.assigned_to !== req.user.id
    ) {
      return res.send("Unauthorized.");
    }

    await pool.query(
      "UPDATE tasks SET status = $1 WHERE id = $2",
      [req.body.status, req.params.id]
    );

    res.redirect("/dashboard");
  } catch (err) {
    console.error("STATUS UPDATE ERROR:", err.message);
    res.send("Status update failed.");
  }
});

/* ---------- PROJECT MEMBERS ---------- */
app.post(
  "/projects/:id/add-member",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id FROM users WHERE username = $1",
        [req.body.username]
      );

      if (!result.rows[0]) {
        return res.send("User not found.");
      }

      await pool.query(
        "INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [req.params.id, result.rows[0].id]
      );

      res.redirect("/dashboard");
    } catch (err) {
      console.error("ADD MEMBER ERROR:", err.message);
      res.send("Failed to add member.");
    }
  }
);

/* ---------- PROMOTE ADMIN ---------- */
app.post(
  "/make-admin/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      await pool.query(
        "UPDATE users SET role = 'admin' WHERE id = $1",
        [req.params.id]
      );

      res.redirect("/dashboard");
    } catch (err) {
      console.error("PROMOTE ERROR:", err.message);
      res.send("Promotion failed.");
    }
  }
);

/* ---------- LOGOUT ---------- */
app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

/* =========================
   SERVER
========================= */
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
