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

// Database connection - NO ERROR THROWING
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/taskdb';
console.log('DATABASE_URL from env:', process.env.DATABASE_URL ? 'YES' : 'NO');

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl && databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false,
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('DB connection error:', err.message);
  } else {
    console.log('DB connected successfully');
    release();
  }
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
`).then(() => console.log('Tables ready')).catch(err => console.log('Table error:', err.message));

app.get('/', (req, res) => res.render('landing'));
app.get('/login', (req, res) => res.render('login'));
app.get('/signup', (req, res) => res.render('signup'));

app.post('/signup', async (req, res) => {
  const { username, password, email } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const role = email && email.toLowerCase().endsWith('@astra.com') ? 'admin' : 'member';
    await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4)',
      [username, email, hashedPassword, role]
    );
    res.redirect('/login');
  } catch (err) {
    res.send('Signup error: ' + err.message);
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.send('User not found');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.send('Invalid password');
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role, email: user.email }, process.env.JWT_SECRET || 'secret');
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/dashboard');
  } catch (err) {
    res.send('Login error: ' + err.message);
  }
});

app.get('/dashboard', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const isAdmin = user.role === 'admin';
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Dashboard</title><style>
        body{font-family:Arial;background:#0F172A;color:white;padding:40px}
        .card{background:#1E1B4B;padding:30px;border-radius:20px}
        .badge{background:#4F46E5;padding:5px 15px;border-radius:20px}
        a{color:#4F46E5}
      </style></head>
      <body>
        <div class="card">
          <h1>Welcome ${user.username}!</h1>
          <p>Role: <span class="badge">${user.role}</span></p>
          <p>Email: ${user.email}</p>
          <a href="/logout">Logout</a>
        </div>
      </body>
      </html>
    `);
  } catch {
    res.redirect('/login');
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
