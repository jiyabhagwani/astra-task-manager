const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Get database URL from environment - NO ERROR THROWING
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/taskdb';
console.log('DATABASE_URL exists:', !!databaseUrl);

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl && databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false,
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection FAILED:', err.message);
  } else {
    console.log('Database connected successfully');
    release();
  }
});

// Create tables
async function initDB() {
  try {
    await pool.query(\`
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
    \`);
    console.log('Tables ready');
  } catch (err) {
    console.error('Table error:', err.message);
  }
}
initDB();

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

app.get('/', (req, res) => res.render('landing'));

app.get('/login', (req, res) => {
  res.render('login');
});

app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/signup', async (req, res) => {
  const { username, password, email } = req.body;
  console.log('Signup attempt:', email);
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const role = email && email.toLowerCase().endsWith('@astra.com') ? 'admin' : 'member';
    
    await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4)',
      [username, email, hashedPassword, role]
    );
    console.log('Signup successful:', email);
    res.redirect('/login');
  } catch (err) {
    console.error('Signup error:', err.message);
    res.send('Error creating account: ' + err.message);
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('Login attempt:', email);
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.send('User not found');
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.send('Invalid password');
    
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role, email: user.email }, process.env.JWT_SECRET || 'secret');
    res.cookie('token', token, { httpOnly: true });
    console.log('Login successful:', email);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err.message);
    res.send('Login error: ' + err.message);
  }
});

app.get('/dashboard', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const isAdmin = user.role === 'admin';
    const greeting = getGreeting();
    
    if (isAdmin) {
      const projectsResult = await pool.query('SELECT * FROM projects');
      const tasksResult = await pool.query('SELECT t.*, p.name as project_name, u.username as assigned_to_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assigned_to = u.id');
      const usersResult = await pool.query('SELECT id, username, email, role FROM users');
      const overdue = tasksResult.rows.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done');
      const totalTasks = tasksResult.rows.length;
      const completedTasks = tasksResult.rows.filter(t => t.status === 'done').length;
      const productivityScore = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
      
      res.render('dashboard', { 
        user, 
        projects: projectsResult.rows, 
        tasks: tasksResult.rows, 
        overdue,
        isAdmin: true,
        allUsers: usersResult.rows,
        greeting,
        productivityScore
      });
    } else {
      const projectsResult = await pool.query('SELECT p.* FROM projects p JOIN project_members pm ON p.id = pm.project_id WHERE pm.user_id = $1', [user.id]);
      const tasksResult = await pool.query('SELECT t.*, p.name as project_name, u.username as assigned_to_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assigned_to = u.id WHERE t.assigned_to = $1', [user.id]);
      const overdue = tasksResult.rows.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done');
      const totalTasks = tasksResult.rows.length;
      const completedTasks = tasksResult.rows.filter(t => t.status === 'done').length;
      const productivityScore = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
      
      res.render('dashboard', { 
        user, 
        projects: projectsResult.rows, 
        tasks: tasksResult.rows, 
        overdue,
        isAdmin: false,
        allUsers: [],
        greeting,
        productivityScore
      });
    }
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.redirect('/login');
  }
});

app.post('/projects', async (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
  if (user.role !== 'admin') return res.send('Only admins can create projects');
  
  const result = await pool.query('INSERT INTO projects (name, created_by) VALUES ($1, $2) RETURNING id', [req.body.name, user.id]);
  await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)', [result.rows[0].id, user.id]);
  res.redirect('/dashboard');
});

app.post('/tasks', async (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
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
  const user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
  if (user.role !== 'admin') return res.send('Admin only');
  
  const result = await pool.query('SELECT id FROM users WHERE username = $1', [req.body.username]);
  if (result.rows[0]) {
    await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)', [req.params.id, result.rows[0].id]);
  }
  res.redirect('/dashboard');
});

app.post('/make-admin/:id', async (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
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
    const user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const isAdmin = user.role === 'admin';
    
    if (isAdmin) {
      const projects = await pool.query('SELECT * FROM projects');
      const tasks = await pool.query('SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id');
      res.json({ projects: projects.rows, tasks: tasks.rows });
    } else {
      const projects = await pool.query('SELECT p.* FROM projects p JOIN project_members pm ON p.id = pm.project_id WHERE pm.user_id = $1', [user.id]);
      const tasks = await pool.query('SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.assigned_to = $1', [user.id]);
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
    const user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    if (user.role !== 'admin') return res.json({ error: 'Admin only' });
    
    const users = await pool.query('SELECT id, username, email, role FROM users');
    res.json(users.rows);
  } catch {
    res.json({ error: 'Unauthorized' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
