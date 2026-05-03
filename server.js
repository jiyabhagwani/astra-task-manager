const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/taskmanager',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Create tables
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'member'
  );
  
  CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT,
    created_by INTEGER
  );
  
  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER,
    user_id INTEGER
  );
  
  CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'medium',
    due_date TEXT,
    project_id INTEGER,
    assigned_to INTEGER,
    created_by INTEGER
  );
`).then(() => console.log('Database ready')).catch(err => console.log('DB Error:', err.message));

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

app.get('/', (req, res) => res.render('landing'));

app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Login</title><style>body{font-family:Arial;background:linear-gradient(135deg,#0F172A,#1E1B4B);display:flex;justify-content:center;align-items:center;height:100vh}.card{background:#1E1B4B;padding:40px;border-radius:20px;width:400px}.logo{font-size:32px;color:#4F46E5;text-align:center}.input{width:100%;padding:12px;margin:10px 0;background:#0F172A;border:none;color:white;border-radius:8px}.btn{width:100%;padding:12px;background:#4F46E5;border:none;border-radius:8px;color:white;cursor:pointer}.note{text-align:center;margin-top:15px;font-size:12px;color:#94A3B8}</style></head>
<body><div class="card"><div class="logo">✨ ASTRA</div><form method="POST" action="/login"><input class="input" type="email" name="email" placeholder="Email" required><input class="input" type="password" name="password" placeholder="Password" required><button class="btn" type="submit">Login</button></form><div class="note"><a href="/signup">Sign up</a> | @astra.com = Admin</div></div></body></html>
  `);
});

app.get('/signup', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Signup</title><style>body{font-family:Arial;background:linear-gradient(135deg,#0F172A,#1E1B4B);display:flex;justify-content:center;align-items:center;height:100vh}.card{background:#1E1B4B;padding:40px;border-radius:20px;width:400px}.logo{font-size:32px;color:#4F46E5;text-align:center}.input{width:100%;padding:12px;margin:10px 0;background:#0F172A;border:none;color:white;border-radius:8px}.btn{width:100%;padding:12px;background:#4F46E5;border:none;border-radius:8px;color:white;cursor:pointer}.note{text-align:center;margin-top:15px;font-size:12px;color:#94A3B8}</style></head>
<body><div class="card"><div class="logo">✨ ASTRA</div><form method="POST" action="/signup"><input class="input" type="email" name="email" placeholder="Email" required><input class="input" type="text" name="username" placeholder="Username" required><input class="input" type="password" name="password" placeholder="Password" required><button class="btn" type="submit">Sign Up</button></form><div class="note"><a href="/login">Login</a></div></div></body></html>
  `);
});

app.post('/signup', async (req, res) => {
  const { username, password, email } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const role = email && email.toLowerCase().endsWith('@astra.com') ? 'admin' : 'member';
  
  try {
    await pool.query('INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4)', [username, email, hashedPassword, role]);
    res.redirect('/login');
  } catch (err) {
    res.send('Username or email already exists');
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.send('Invalid credentials');
  }
  
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, email: user.email }, 'secret');
  res.cookie('token', token, { httpOnly: true });
  res.redirect('/dashboard');
});

app.get('/dashboard', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  
  try {
    const user = jwt.verify(token, 'secret');
    const isAdmin = user.role === 'admin';
    const greeting = getGreeting();
    
    if (isAdmin) {
      const projects = await pool.query('SELECT * FROM projects');
      const tasks = await pool.query('SELECT t.*, p.name as project_name, u.username as assigned_to_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assigned_to = u.id');
      const allUsers = await pool.query('SELECT id, username, email, role FROM users');
      const overdue = tasks.rows.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done');
      const totalTasks = tasks.rows.length;
      const completedTasks = tasks.rows.filter(t => t.status === 'done').length;
      const productivityScore = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
      
      res.render('dashboard', { user, projects: projects.rows, tasks: tasks.rows, overdue, isAdmin: true, allUsers: allUsers.rows, greeting, productivityScore });
    } else {
      const projects = await pool.query('SELECT p.* FROM projects p JOIN project_members pm ON p.id = pm.project_id WHERE pm.user_id = $1', [user.id]);
      const tasks = await pool.query('SELECT t.*, p.name as project_name, u.username as assigned_to_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assigned_to = u.id WHERE t.assigned_to = $1', [user.id]);
      const overdue = tasks.rows.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done');
      const totalTasks = tasks.rows.length;
      const completedTasks = tasks.rows.filter(t => t.status === 'done').length;
      const productivityScore = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
      
      res.render('dashboard', { user, projects: projects.rows, tasks: tasks.rows, overdue, isAdmin: false, allUsers: [], greeting, productivityScore });
    }
  } catch {
    res.redirect('/login');
  }
});

app.post('/projects', async (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, 'secret');
  if (user.role !== 'admin') return res.send('Only admins can create projects');
  
  const result = await pool.query('INSERT INTO projects (name, created_by) VALUES ($1, $2) RETURNING id', [req.body.name, user.id]);
  await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)', [result.rows[0].id, user.id]);
  res.redirect('/dashboard');
});

app.post('/tasks', async (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, 'secret');
  const assignedTo = req.body.assigned_to || user.id;
  const priority = req.body.priority || 'medium';
  
  await pool.query('INSERT INTO tasks (title, description, due_date, assigned_to, project_id, created_by, priority) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [req.body.title, req.body.description, req.body.due_date, assignedTo, req.body.project_id, user.id, priority]);
  res.redirect('/dashboard');
});

app.post('/tasks/:id/status', async (req, res) => {
  await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
  res.redirect('/dashboard');
});

app.post('/projects/:id/add-member', async (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, 'secret');
  if (user.role !== 'admin') return res.send('Admin only');
  
  const result = await pool.query('SELECT id FROM users WHERE username = $1', [req.body.username]);
  if (result.rows[0]) {
    await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)', [req.params.id, result.rows[0].id]);
  }
  res.redirect('/dashboard');
});

app.post('/make-admin/:id', async (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, 'secret');
  if (user.role !== 'admin') return res.send('Admin only');
  
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', req.params.id]);
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

app.get('/api/data', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ error: 'Unauthorized' });
  
  try {
    const user = jwt.verify(token, 'secret');
    const isAdmin = user.role === 'admin';
    
    if (isAdmin) {
      const projects = await pool.query('SELECT * FROM projects');
      const tasks = await pool.query('SELECT t.*, p.name as project_name, u.username as assigned_to_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assigned_to = u.id');
      res.json({ projects: projects.rows, tasks: tasks.rows });
    } else {
      const projects = await pool.query('SELECT p.* FROM projects p JOIN project_members pm ON p.id = pm.project_id WHERE pm.user_id = $1', [user.id]);
      const tasks = await pool.query('SELECT t.*, p.name as project_name, u.username as assigned_to_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assigned_to = u.id WHERE t.assigned_to = $1', [user.id]);
      res.json({ projects: projects.rows, tasks: tasks.rows });
    }
  } catch {
    res.json({ error: 'Unauthorized' });
  }
});

app.get('/api/users', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ error: 'Unauthorized' });
  
  try {
    const user = jwt.verify(token, 'secret');
    if (user.role !== 'admin') return res.json({ error: 'Admin only' });
    
    const users = await pool.query('SELECT id, username, email, role FROM users');
    res.json(users.rows);
  } catch {
    res.json({ error: 'Unauthorized' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
