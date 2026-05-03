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

// ✅ Railway DATABASE_URL is always available
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
  if (err) console.error('❌ DB connection failed:', err.message);
  else console.log('✅ DB connected');
});

pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'member'
  );
`).catch(err => console.log(err.message));

app.get('/', (req, res) => res.render('landing'));
app.get('/login', (req, res) => res.render('login'));
app.get('/signup', (req, res) => res.render('signup'));

app.post('/signup', async (req, res) => {
  const { username, password, email } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const role = email?.endsWith('@astra.com') ? 'admin' : 'member';
    await pool.query(
      `INSERT INTO users (username, email, password, role)
       VALUES ($1, $2, $3, $4)`,
      [username, email, hash, role]
    );
    res.redirect('/login');
  } catch (err) {
    res.send('Signup error: ' + err.message);
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.send('Invalid credentials');

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, email: user.email },
      process.env.JWT_SECRET || 'secret'
    );
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
    res.send(`
      <h2>Welcome ${user.username}</h2>
      <p>Role: <strong>${user.role}</strong></p>
      <p>Email: ${user.email}</p>
      <a href="/logout">Logout</a>
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
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));
