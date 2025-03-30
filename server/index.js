import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// Database setup
let db;
async function initializeDatabase() {
  db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  });

  // Create users table if it doesn't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Database initialized');
}

initializeDatabase().catch(console.error);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'image') {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed!'));
      }
    } else if (file.fieldname === 'pdf') {
      if (file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Only PDF files are allowed!'));
      }
    } else {
      cb(new Error('Unexpected field'));
    }
  }
});

// Create uploads directory if it doesn't exist
import fs from 'fs';
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// User registration endpoint
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  
  // Validate input
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters long' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  try {
    // Check if username already exists
    const existingUser = await db.get('SELECT username FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Insert user into database
    await db.run(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword]
    );
    
    res.json({ 
      message: 'User registered successfully',
      user: { username }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Get user from database
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json({ 
      message: 'Login successful',
      user: { username, id: user.id }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Image upload endpoint
app.post('/upload/image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ path: `/uploads/${req.file.filename}` });
});

// PDF upload endpoint
app.post('/upload/pdf', upload.single('pdf'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ path: `/uploads/${req.file.filename}` });
});

const clients = new Map();

wss.on('connection', (ws) => {
  let currentUser = null;

  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    if (data.type === 'login') {
      try {
        // Get user from database
        const user = await db.get('SELECT * FROM users WHERE username = ?', [data.username]);
        
        if (!user) {
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Invalid username or password'
          }));
          return;
        }

        // Verify password
        const validPassword = await bcrypt.compare(data.password, user.password);
        if (!validPassword) {
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Invalid username or password'
          }));
          return;
        }

        currentUser = data.username;
        clients.set(ws, currentUser);
        ws.send(JSON.stringify({
          type: 'system',
          content: `Welcome, ${currentUser}!`
        }));
        // Broadcast user joined message
        broadcast({
          type: 'system',
          content: `${currentUser} joined the chat`
        }, ws);
      } catch (error) {
        console.error('WebSocket login error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          content: 'Internal server error'
        }));
      }
    } else if (currentUser) {
      // Handle other message types
      const messageData = {
        ...data,
        username: currentUser,
        timestamp: new Date()
      };

      if (data.type === 'message') {
        broadcast(messageData, ws);
      } else if (data.type === 'image') {
        broadcast(messageData, ws);
      } else if (data.type === 'pdf') {
        broadcast(messageData, ws);
      } else if (data.type === 'emoji') {
        broadcast(messageData, ws);
      }
    }
  });

  ws.on('close', () => {
    if (currentUser) {
      clients.delete(ws);
      broadcast({
        type: 'system',
        content: `${currentUser} left the chat`
      });
    }
  });
});

function broadcast(data, exclude = null) {
  wss.clients.forEach((client) => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 