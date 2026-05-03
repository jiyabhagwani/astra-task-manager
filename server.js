require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SECRET_KEY || 'secret123',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 1000 * 60 * 60 * 24
  }
}));

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// ── Home ─────────────────────────────────────
app.get('/', (req, res) => {
  res.redirect('/login');
});

// ── Login ────────────────────────────────────
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = db.prepare(
      'SELECT * FROM users WHERE username = ?'
    ).get(username);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.render('login', {
        error: 'Invalid username or password'
      });
    }

    req.session.user = user;

    res.redirect('/dashboard');

  } catch (err) {
    console.error('Login error:', err);

    res.render('login', {
      error: 'Login failed: ' + err.message
    });
  }
});

// ── Signup ───────────────────────────────────
app.get('/signup', (req, res) => {
  res.render('signup', { error: null });
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

    db.prepare(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
    ).run(username, email, hash);

    res.redirect('/login');

  } catch (err) {
    console.error('Signup error:', err);

    res.render('signup', {
      error: 'Signup failed: ' + err.message
    });
  }
});

// ── Logout ───────────────────────────────────
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ── Dashboard ────────────────────────────────
app.get('/dashboard', requireLogin, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';

  res.render('dashboard', {
    user: req.session.user,
    isAdmin
  });
});

// ── API Data ─────────────────────────────────
app.get('/api/data', requireLogin, (req, res) => {
  const userId = req.session.user.id;

  const projects = db.prepare(`
    SELECT p.* FROM projects p
    LEFT JOIN project_members pm
    ON p.id = pm.project_id
    WHERE p.created_by = ?
    OR pm.user_id = ?
  `).all(userId, userId);

  const tasks = db.prepare(`
    SELECT t.*, p.name as project_name
    FROM tasks t
    LEFT JOIN projects p
    ON t.project_id = p.id
    WHERE t.assigned_to = ?
  `).all(userId);

  res.json({ projects, tasks });
});

// ── Users API ────────────────────────────────
app.get('/api/users', requireLogin, (req, res) => {
  const users = db.prepare(
    'SELECT id, username, role FROM users'
  ).all();

  res.json(users);
});

// ── Projects ─────────────────────────────────
app.post('/projects', requireLogin, (req, res) => {
  const { name } = req.body;

  const result = db.prepare(
    'INSERT INTO projects (name, created_by) VALUES (?, ?)'
  ).run(name, req.session.user.id);

  db.prepare(
    'INSERT INTO project_members (project_id, user_id) VALUES (?, ?)'
  ).run(result.lastInsertRowid, req.session.user.id);

  res.redirect('/dashboard');
});

app.post('/projects/:id/add-member', requireLogin, (req, res) => {
  const { username } = req.body;

  const projectId = req.params.id;

  const user = db.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).get(username);

  if (user) {
    db.prepare(
      'INSERT INTO project_members (project_id, user_id) VALUES (?, ?)'
    ).run(projectId, user.id);
  }

  res.redirect('/dashboard');
});

// ── Tasks ────────────────────────────────────
app.post('/tasks', requireLogin, (req, res) => {
  const { title, description, project_id, due_date } = req.body;

  db.prepare(`
    INSERT INTO tasks
    (title, description, project_id, assigned_to, due_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    title,
    description,
    project_id || null,
    req.session.user.id,
    due_date || null
  );

  res.redirect('/dashboard');
});

app.post('/tasks/:id/status', requireLogin, (req, res) => {
  db.prepare(
    'UPDATE tasks SET status = ? WHERE id = ?'
  ).run(req.body.status, req.params.id);

  res.redirect('/dashboard');
});

// ── Admin ────────────────────────────────────
app.post('/make-admin/:id', requireLogin, (req, res) => {
  if (req.session.user.role !== 'admin') {
    return res.status(403).send('Forbidden');
  }

  db.prepare(
    'UPDATE users SET role = ? WHERE id = ?'
  ).run('admin', req.params.id);

  res.redirect('/dashboard');
});

// ── Start Server ─────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
