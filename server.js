const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database(path.join(__dirname, 'taskmanager.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'member'
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    created_by INTEGER
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER,
    user_id INTEGER
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'medium',
    due_date TEXT,
    project_id INTEGER,
    assigned_to INTEGER,
    created_by INTEGER
  )`);
  
  console.log('Database ready');
});

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
    <head>
      <title>ASTRA | Login</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Segoe UI',Arial;background:linear-gradient(135deg,#0F172A,#1E1B4B);min-height:100vh;display:flex;justify-content:center;align-items:center}
        .card{background:rgba(30,27,75,0.8);backdrop-filter:blur(10px);border-radius:24px;padding:40px;width:400px;border:1px solid rgba(79,70,229,0.3)}
        h2{color:white;text-align:center;margin-bottom:30px}
        input{width:100%;padding:12px;margin:10px 0;border-radius:8px;border:none;background:#0F172A;color:white}
        button{width:100%;padding:12px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;font-size:16px}
        button:hover{background:#6366F1}
        a{color:#94A3B8;text-decoration:none;display:block;text-align:center;margin-top:15px}
        .logo{text-align:center;font-size:32px;font-weight:bold;color:#4F46E5;margin-bottom:30px}
        .note{text-align:center;margin-top:15px;font-size:12px;color:#4F46E5}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">✨ ASTRA</div>
        <h2>Welcome Back</h2>
        <form method="POST" action="/login">
          <input type="email" name="email" placeholder="Email" required>
          <input type="password" name="password" placeholder="Password" required>
          <button type="submit">Login →</button>
        </form>
        <a href="/signup">Don't have an account? Sign up</a>
        <div class="note">🔐 Use @astra.com email for Admin access</div>
      </div>
    </body>
    </html>
  `);
});

app.get('/signup', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ASTRA | Sign Up</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Segoe UI',Arial;background:linear-gradient(135deg,#0F172A,#1E1B4B);min-height:100vh;display:flex;justify-content:center;align-items:center}
        .card{background:rgba(30,27,75,0.8);backdrop-filter:blur(10px);border-radius:24px;padding:40px;width:400px;border:1px solid rgba(79,70,229,0.3)}
        h2{color:white;text-align:center;margin-bottom:30px}
        input{width:100%;padding:12px;margin:10px 0;border-radius:8px;border:none;background:#0F172A;color:white}
        button{width:100%;padding:12px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;font-size:16px}
        button:hover{background:#6366F1}
        a{color:#94A3B8;text-decoration:none;display:block;text-align:center;margin-top:15px}
        .logo{text-align:center;font-size:32px;font-weight:bold;color:#4F46E5;margin-bottom:30px}
        .note{text-align:center;margin-top:15px;font-size:12px;color:#4F46E5}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">✨ ASTRA</div>
        <h2>Create Account</h2>
        <form method="POST" action="/signup">
          <input type="email" name="email" placeholder="Email" required>
          <input type="text" name="username" placeholder="Username" required>
          <input type="password" name="password" placeholder="Password" required>
          <button type="submit">Sign Up →</button>
        </form>
        <a href="/login">Already have an account? Login</a>
        <div class="note">✨ Users with @astra.com email become Admin</div>
      </div>
    </body>
    </html>
  `);
});

app.post('/signup', async (req, res) => {
  const { username, password, email } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  
  // Check if email ends with @astra.com
  const isAdminEmail = email && email.toLowerCase().endsWith('@astra.com');
  const role = isAdminEmail ? 'admin' : 'member';
  
  db.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', 
    [username, email, hashedPassword, role], 
    function(err) {
      if (err) return res.send('Username or email already exists');
      res.redirect('/login');
    });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) return res.send('Invalid credentials');
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.send('Invalid credentials');
    
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role, email: user.email }, 'secret');
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/dashboard');
  });
});

app.get('/dashboard', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  
  try {
    const user = jwt.verify(token, 'secret');
    const isAdmin = user.role === 'admin';
    const greeting = getGreeting();
    
    if (isAdmin) {
      db.all('SELECT * FROM projects', [], (err, projects) => {
        db.all(`SELECT t.*, p.name as project_name, u.username as assigned_to_name 
                FROM tasks t 
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN users u ON t.assigned_to = u.id`, [], (err, tasks) => {
          db.all('SELECT id, username, email, role FROM users', [], (err, allUsers) => {
            const overdue = tasks.filter(t => 
              t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done'
            );
            
            const totalTasks = tasks.length;
            const completedTasks = tasks.filter(t => t.status === 'done').length;
            const productivityScore = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
            
            res.render('dashboard', { 
              user, 
              projects: projects || [], 
              tasks: tasks || [], 
              overdue,
              isAdmin: true,
              allUsers: allUsers || [],
              greeting,
              productivityScore
            });
          });
        });
      });
    } else {
      db.all(`
        SELECT p.* FROM projects p
        JOIN project_members pm ON p.id = pm.project_id
        WHERE pm.user_id = ?
      `, [user.id], (err, projects) => {
        db.all(`
          SELECT t.*, p.name as project_name, u.username as assigned_to_name 
          FROM tasks t 
          LEFT JOIN projects p ON t.project_id = p.id
          LEFT JOIN users u ON t.assigned_to = u.id
          WHERE t.assigned_to = ?
        `, [user.id], (err, tasks) => {
          const overdue = tasks.filter(t => 
            t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done'
          );
          
          const totalTasks = tasks.length;
          const completedTasks = tasks.filter(t => t.status === 'done').length;
          const productivityScore = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
          
          res.render('dashboard', { 
            user, 
            projects: projects || [], 
            tasks: tasks || [], 
            overdue,
            isAdmin: false,
            allUsers: [],
            greeting,
            productivityScore
          });
        });
      });
    }
  } catch {
    res.redirect('/login');
  }
});

app.post('/projects', (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, 'secret');
  
  if (user.role !== 'admin') {
    return res.send('Only admins can create projects');
  }
  
  db.run('INSERT INTO projects (name, created_by) VALUES (?, ?)', [req.body.name, user.id], function(err) {
    if (err) return res.send('Error creating project');
    const projectId = this.lastID;
    db.run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [projectId, user.id]);
    res.redirect('/dashboard');
  });
});

app.post('/tasks', (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, 'secret');
  
  const assignedTo = req.body.assigned_to || user.id;
  const priority = req.body.priority || 'medium';
  
  db.run('INSERT INTO tasks (title, description, due_date, assigned_to, project_id, created_by, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.body.title, req.body.description, req.body.due_date, assignedTo, req.body.project_id, user.id, priority],
    function(err) {
      if (err) return res.send('Error creating task: ' + err.message);
      res.redirect('/dashboard');
    });
});

app.post('/tasks/:id/status', (req, res) => {
  db.run('UPDATE tasks SET status = ? WHERE id = ?', [req.body.status, req.params.id], function(err) {
    if (err) return res.send('Error updating status');
    res.redirect('/dashboard');
  });
});

app.post('/projects/:id/add-member', (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, 'secret');
  
  if (user.role !== 'admin') return res.send('Admin only');
  
  const projectId = req.params.id;
  const { username } = req.body;
  
  db.get('SELECT id FROM users WHERE username = ?', [username], (err, userToAdd) => {
    if (err || !userToAdd) {
      return res.redirect('/dashboard');
    }
    db.run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', [projectId, userToAdd.id], () => {
      res.redirect('/dashboard');
    });
  });
});

app.post('/make-admin/:id', (req, res) => {
  const token = req.cookies.token;
  const user = jwt.verify(token, 'secret');
  
  if (user.role !== 'admin') return res.send('Admin only');
  
  db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', req.params.id], function(err) {
    if (err) return res.send('Error making admin');
    res.redirect('/dashboard');
  });
});

app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

app.get('/api/data', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ error: 'Unauthorized' });
  
  try {
    const user = jwt.verify(token, 'secret');
    const isAdmin = user.role === 'admin';
    
    if (isAdmin) {
      db.all('SELECT * FROM projects', [], (err, projects) => {
        db.all(`SELECT t.*, p.name as project_name, u.username as assigned_to_name 
                FROM tasks t 
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN users u ON t.assigned_to = u.id`, [], (err, tasks) => {
          res.json({ projects: projects || [], tasks: tasks || [] });
        });
      });
    } else {
      db.all(`
        SELECT p.* FROM projects p
        JOIN project_members pm ON p.id = pm.project_id
        WHERE pm.user_id = ?
      `, [user.id], (err, projects) => {
        db.all(`
          SELECT t.*, p.name as project_name, u.username as assigned_to_name 
          FROM tasks t 
          LEFT JOIN projects p ON t.project_id = p.id
          LEFT JOIN users u ON t.assigned_to = u.id
          WHERE t.assigned_to = ?
        `, [user.id], (err, tasks) => {
          res.json({ projects: projects || [], tasks: tasks || [] });
        });
      });
    }
  } catch {
    res.json({ error: 'Unauthorized' });
  }
});

app.get('/api/users', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ error: 'Unauthorized' });
  
  try {
    const user = jwt.verify(token, 'secret');
    if (user.role !== 'admin') return res.json({ error: 'Admin only' });
    
    db.all('SELECT id, username, email, role FROM users', [], (err, users) => {
      res.json(users || []);
    });
  } catch {
    res.json({ error: 'Unauthorized' });
  }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
