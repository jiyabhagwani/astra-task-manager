require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();

// ─────────────────────────────────────────────
// APP CONFIG
// ─────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SECRET_KEY || 'astra_super_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 1000 * 60 * 60 * 24
  }
}));

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).send('Forbidden');
  }

  next();
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return 'Good Morning';
  if (hour < 18) return 'Good Afternoon';

  return 'Good Evening';
}

// ─────────────────────────────────────────────
// HOME
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.redirect('/login');
});

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
app.get('/login', (req, res) => {
  res.render('login', {
    error: null
  });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = db.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).get(email);

    if (!user) {
      return res.render('login', {
        error: 'Invalid email or password'
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password
    );

    if (!validPassword) {
      return res.render('login', {
        error: 'Invalid email or password'
      });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role || 'member'
    };

    req.session.save((err) => {
      if (err) {
        console.error('Session Save Error:', err);

        return res.render('login', {
          error: 'Session failed'
        });
      }

      return res.redirect('/dashboard');
    });

  } catch (err) {
    console.error('Login Error:', err);

    return res.render('login', {
      error: 'Login failed'
    });
  }
});

// ─────────────────────────────────────────────
// SIGNUP
// ─────────────────────────────────────────────
app.get('/signup', (req, res) => {
  res.render('signup', {
    error: null
  });
});

app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const existingUser = db.prepare(
      'SELECT * FROM users WHERE username = ? OR email = ?'
    ).get(username, email);

    if (existingUser) {
      return res.render('signup', {
        error: 'Username or email already exists'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const role = email.endsWith('@astra.com')
      ? 'admin'
      : 'member';

    db.prepare(`
      INSERT INTO users
      (username, email, password, role)
      VALUES (?, ?, ?, ?)
    `).run(
      username,
      email,
      hash,
      role
    );

    res.redirect('/login');

  } catch (err) {
    console.error('Signup Error:', err);

    res.render('signup', {
      error: 'Signup failed'
    });
  }
});

// ─────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
app.get('/dashboard', requireLogin, (req, res) => {
  try {
    let announcement = null;

    try {
      announcement = db.prepare(`
        SELECT * FROM announcements
        ORDER BY created_at DESC
        LIMIT 1
      `).get();
    } catch {
      announcement = null;
    }

    res.render('dashboard', {
      user: req.session.user,
      isAdmin: req.session.user.role === 'admin',
      greeting: getGreeting(),
      announcement
    });

  } catch (err) {
    console.error('Dashboard Error:', err);

    res.status(500).send(
      'Dashboard failed to load'
    );
  }
});

// ─────────────────────────────────────────────
// DASHBOARD DATA API
// ─────────────────────────────────────────────
app.get('/api/data', requireLogin, (req, res) => {
  try {
    const userId = req.session.user.id;

    const projects = db.prepare(`
      SELECT DISTINCT p.*
      FROM projects p
      LEFT JOIN project_members pm
      ON p.id = pm.project_id
      WHERE p.created_by = ?
      OR pm.user_id = ?
    `).all(userId, userId);

    const tasks = db.prepare(`
      SELECT
        t.*,
        p.name AS project_name,
        u.username AS assigned_to_name
      FROM tasks t
      LEFT JOIN projects p
      ON t.project_id = p.id
      LEFT JOIN users u
      ON t.assigned_to = u.id
      WHERE t.assigned_to = ?
      OR t.project_id IN (
        SELECT project_id
        FROM project_members
        WHERE user_id = ?
      )
    `).all(userId, userId);

    res.json({
      projects: projects || [],
      tasks: tasks || []
    });

  } catch (err) {
    console.error('API Data Error:', err);

    res.status(500).json({
      error: 'Failed to load dashboard data'
    });
  }
});

// ─────────────────────────────────────────────
// USERS API
// ─────────────────────────────────────────────
app.get('/api/users', requireLogin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, email, role
      FROM users
    `).all();

    res.json(users || []);

  } catch (err) {
    console.error('Users API Error:', err);

    res.status(500).json({
      error: 'Failed to load users'
    });
  }
});

// ─────────────────────────────────────────────
// ADMIN ANALYTICS
// ─────────────────────────────────────────────
app.get('/api/admin/stats', requireLogin, requireAdmin, (req, res) => {
  try {
    const totalUsers = db.prepare(
      'SELECT COUNT(*) as count FROM users'
    ).get().count;

    const totalProjects = db.prepare(
      'SELECT COUNT(*) as count FROM projects'
    ).get().count;

    const totalTasks = db.prepare(
      'SELECT COUNT(*) as count FROM tasks'
    ).get().count;

    const completedTasks = db.prepare(
      `SELECT COUNT(*) as count
       FROM tasks
       WHERE status = 'done'`
    ).get().count;

    const overdueTasks = db.prepare(`
      SELECT COUNT(*) as count
      FROM tasks
      WHERE due_date IS NOT NULL
      AND due_date < date('now')
      AND status != 'done'
    `).get().count;

    const teamEfficiency =
      totalTasks === 0
        ? 0
        : Math.round(
            (completedTasks / totalTasks) * 100
          );

    res.json({
      totalUsers,
      totalProjects,
      totalTasks,
      overdueTasks,
      teamEfficiency
    });

  } catch (err) {
    console.error('Admin Stats Error:', err);

    res.status(500).json({
      error: 'Failed to load admin stats'
    });
  }
});

// ─────────────────────────────────────────────
// PROJECTS
// ─────────────────────────────────────────────
app.post('/projects', requireLogin, (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.redirect('/dashboard');
    }

    const result = db.prepare(`
      INSERT INTO projects
      (name, created_by)
      VALUES (?, ?)
    `).run(
      name,
      req.session.user.id
    );

    db.prepare(`
      INSERT INTO project_members
      (project_id, user_id)
      VALUES (?, ?)
    `).run(
      result.lastInsertRowid,
      req.session.user.id
    );

    res.redirect('/dashboard');

  } catch (err) {
    console.error('Project Error:', err);

    res.status(500).send(
      'Failed to create project'
    );
  }
});

app.post('/projects/:id/add-member', requireLogin, (req, res) => {
  try {
    const { username } = req.body;

    const user = db.prepare(`
      SELECT id
      FROM users
      WHERE username = ?
    `).get(username);

    if (user) {
      db.prepare(`
        INSERT INTO project_members
        (project_id, user_id)
        VALUES (?, ?)
      `).run(
        req.params.id,
        user.id
      );
    }

    res.redirect('/dashboard');

  } catch (err) {
    console.error('Add Member Error:', err);

    res.status(500).send(
      'Failed to add member'
    );
  }
});

// ─────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────
app.post('/tasks', requireLogin, (req, res) => {
  try {
    const {
      title,
      description,
      project_id,
      assigned_to,
      due_date,
      priority
    } = req.body;

    db.prepare(`
      INSERT INTO tasks
      (title, description, project_id, assigned_to, due_date, priority)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      title,
      description || '',
      project_id || null,
      assigned_to || req.session.user.id,
      due_date || null,
      priority || 'medium'
    );

    res.redirect('/dashboard');

  } catch (err) {
    console.error('Task Error:', err);

    res.status(500).send(
      'Failed to create task'
    );
  }
});

app.post('/tasks/:id/status', requireLogin, (req, res) => {
  try {
    db.prepare(`
      UPDATE tasks
      SET status = ?
      WHERE id = ?
    `).run(
      req.body.status,
      req.params.id
    );

    res.redirect('/dashboard');

  } catch (err) {
    console.error('Task Status Error:', err);

    res.status(500).send(
      'Failed to update task'
    );
  }
});

// ─────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────
app.post('/make-admin/:id', requireLogin, requireAdmin, (req, res) => {
  try {
    db.prepare(`
      UPDATE users
      SET role = 'admin'
      WHERE id = ?
    `).run(req.params.id);

    res.redirect('/dashboard');

  } catch (err) {
    console.error('Make Admin Error:', err);

    res.status(500).send(
      'Failed to promote user'
    );
  }
});

app.post('/admin/announcement', requireLogin, requireAdmin, (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.redirect('/dashboard');
    }

    db.prepare(`
      INSERT INTO announcements
      (message, created_by)
      VALUES (?, ?)
    `).run(
      message,
      req.session.user.id
    );

    res.redirect('/dashboard');

  } catch (err) {
    console.error('Announcement Error:', err);

    res.status(500).send(
      'Failed to create announcement'
    );
  }
});

// ─────────────────────────────────────────────
// GLOBAL ERROR
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Global Server Error:', err);

  res.status(500).send(
    'Internal Server Error'
  );
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Server running on port ${PORT}`
  );
});
