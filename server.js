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

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test route
app.get('/health', (req, res) => {
  res.send('OK');
});

// Simple landing page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>ASTRA</title><style>
      body{font-family:Arial;background:linear-gradient(135deg,#0F172A,#1E1B4B);display:flex;justify-content:center;align-items:center;height:100vh}
      .card{background:#1E1B4B;padding:40px;border-radius:20px;width:400px}
      .logo{font-size:32px;color:#4F46E5;text-align:center}
      a{color:#94A3B8}
    </style></head>
    <body>
      <div class="card">
        <div class="logo">✨ ASTRA</div>
        <p style="color:white;text-align:center">API is running!</p>
        <p style="text-align:center"><a href="/login">Login</a> | <a href="/signup">Signup</a></p>
      </div>
    </body>
    </html>
  `);
});

app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Login</title><style>
      body{font-family:Arial;background:linear-gradient(135deg,#0F172A,#1E1B4B);display:flex;justify-content:center;align-items:center;height:100vh}
      .card{background:#1E1B4B;padding:40px;border-radius:20px;width:400px}
      .logo{font-size:32px;color:#4F46E5;text-align:center}
      input{width:100%;padding:12px;margin:10px 0;background:#0F172A;border:none;color:white;border-radius:8px}
      button{width:100%;padding:12px;background:#4F46E5;border:none;border-radius:8px;color:white;cursor:pointer}
    </style></head>
    <body>
      <div class="card">
        <div class="logo">✨ ASTRA</div>
        <form method="POST" action="/login">
          <input type="email" name="email" placeholder="Email" required>
          <input type="password" name="password" placeholder="Password" required>
          <button type="submit">Login</button>
        </form>
        <p style="text-align:center;margin-top:15px"><a href="/signup">Sign up</a></p>
      </div>
    </body>
    </html>
  `);
});

app.get('/signup', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Signup</title><style>
      body{font-family:Arial;background:linear-gradient(135deg,#0F172A,#1E1B4B);display:flex;justify-content:center;align-items:center;height:100vh}
      .card{background:#1E1B4B;padding:40px;border-radius:20px;width:400px}
      .logo{font-size:32px;color:#4F46E5;text-align:center}
      input{width:100%;padding:12px;margin:10px 0;background:#0F172A;border:none;color:white;border-radius:8px}
      button{width:100%;padding:12px;background:#4F46E5;border:none;border-radius:8px;color:white;cursor:pointer}
    </style></head>
    <body>
      <div class="card">
        <div class="logo">✨ ASTRA</div>
        <form method="POST" action="/signup">
          <input type="email" name="email" placeholder="Email" required>
          <input type="text" name="username" placeholder="Username" required>
          <input type="password" name="password" placeholder="Password" required>
          <button type="submit">Sign Up</button>
        </form>
        <p style="text-align:center;margin-top:15px"><a href="/login">Login</a></p>
      </div>
    </body>
    </html>
  `);
});

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
    res.send('Error: ' + err.message);
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
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role, email: user.email }, 'secret');
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
    const user = jwt.verify(token, 'secret');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Dashboard</title><style>
        body{font-family:Arial;background:#0F172A;color:white;padding:20px}
        .card{background:#1E1B4B;padding:20px;border-radius:20px}
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
