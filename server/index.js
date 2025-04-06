import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 5001;
const wsPort = process.env.WS_PORT || 3001;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server attached to HTTP server
const wss = new WebSocketServer({ 
  server,
  path: '/ws'  // Add explicit WebSocket path
});

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// PostgreSQL configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'chat_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: {
    require: true,  // Ensures a secure connection
    rejectUnauthorized: false // Optional: Disable certificate validation
  }
});

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create chat_rooms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        created_by VARCHAR(50) REFERENCES users(username),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create room_members table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS room_members (
        room_id INTEGER REFERENCES chat_rooms(id) ON DELETE CASCADE,
        username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, username)
      );
    `);

    // Create messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES chat_rooms(id) ON DELETE CASCADE,
        username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
        content TEXT NOT NULL,
        type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

// File upload configuration
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 5242880; // 5MB default

// Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: maxFileSize
  }
});

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// User registration endpoint
app.post('/api/register', async (req, res) => {
  const { username, password, email, confirmPassword } = req.body;

  // Validate input
  if (!username || !password || !email || !confirmPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters long' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    // Check if username exists
    const existingUser = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Check if email exists
    const existingEmail = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    const result = await pool.query('INSERT INTO users (username, password, email) VALUES ($1, $2, $3) RETURNING id', [username, hashedPassword, email]);

    res.status(201).json({ message: 'User registered successfully', userId: result.rows[0].id });
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
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({ 
      message: 'Login successful',
      user: { username, id: user.id },
      token
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

// Chat room endpoints
app.post('/api/rooms', async (req, res) => {
  const { name, username } = req.body;

  if (!name || !username) {
    return res.status(400).json({ error: 'Room name and username are required' });
  }

  try {
    // Check if room name already exists
    const result = await pool.query('SELECT * FROM chat_rooms WHERE name = $1', [name]);
    if (result.rows.length > 0) {
      return res.status(400).json({ error: 'Room name already exists' });
    }

    // Create new room
    const resultRoom = await pool.query('INSERT INTO chat_rooms (name, created_by) VALUES ($1, $2) RETURNING id', [name, username]);
    const roomId = resultRoom.rows[0].id;

    // Add creator as first member
    await pool.query('INSERT INTO room_members (room_id, username) VALUES ($1, $2)', [roomId, username]);

    res.status(201).json({ 
      message: 'Room created successfully',
      room: { id: roomId, name, created_by: username }
    });
  } catch (error) {
    console.error('Room creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cr.*, COUNT(rm.username) as member_count 
      FROM chat_rooms cr 
      LEFT JOIN room_members rm ON cr.id = rm.room_id 
      GROUP BY cr.id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/rooms/:roomId/join', async (req, res) => {
  const { roomId } = req.params;
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    // Check if room exists
    const result = await pool.query('SELECT * FROM chat_rooms WHERE id = $1', [roomId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if user is already a member
    const resultMember = await pool.query('SELECT * FROM room_members WHERE room_id = $1 AND username = $2', [roomId, username]);
    if (resultMember.rows.length > 0) {
      return res.status(400).json({ error: 'Already a member of this room' });
    }

    // Add user to room
    await pool.query('INSERT INTO room_members (room_id, username) VALUES ($1, $2)', [roomId, username]);

    // Get updated member count
    const resultCount = await pool.query('SELECT COUNT(*) as count FROM room_members WHERE room_id = $1', [roomId]);

    res.json({ 
      message: 'Joined room successfully',
      room: {
        ...result.rows[0],
        member_count: resultCount.rows[0].count
      }
    });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ error: 'Failed to join room. Please try again.' });
  }
});

// Add new endpoint for leaving a room
app.post('/api/rooms/:roomId/leave', async (req, res) => {
  const { roomId } = req.params;
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    // Check if user is a member of the room
    const result = await pool.query('SELECT * FROM room_members WHERE room_id = $1 AND username = $2', [roomId, username]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not a member of this room' });
    }

    // Remove user from room
    await pool.query('DELETE FROM room_members WHERE room_id = $1 AND username = $2', [roomId, username]);

    // Get updated member count
    const resultCount = await pool.query('SELECT COUNT(*) as count FROM room_members WHERE room_id = $1', [roomId]);

    res.json({ 
      message: 'Left room successfully',
      room: {
        id: roomId,
        member_count: resultCount.rows[0].count
      }
    });
  } catch (error) {
    console.error('Error leaving room:', error);
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');
  let currentUser = null;
  let currentRoom = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received WebSocket message:', { type: data.type, user: currentUser, room: currentRoom }); // Debug log

      if (data.type === 'login') {
        try {
          // Get user from database
          const result = await pool.query('SELECT * FROM users WHERE username = $1', [data.username]);
          
          if (result.rows.length === 0) {
            ws.send(JSON.stringify({
              type: 'error',
              content: 'Invalid username or password'
            }));
            return;
          }

          const user = result.rows[0];

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
          
          // Check if user was in a room before disconnecting
          const previousClient = Array.from(clients.entries()).find(([_, info]) => info.username === currentUser);
          if (previousClient) {
            currentRoom = previousClient[1].room;
            console.log('Restored previous room state:', { currentUser, currentRoom }); // Debug log
          }
          
          // Update client info
          clients.set(ws, { username: currentUser, room: currentRoom });
          console.log('User logged in:', { currentUser, currentRoom }); // Debug log
          
          ws.send(JSON.stringify({
            type: 'system',
            content: `Welcome, ${currentUser}!`
          }));

          // If user was in a room, notify them and broadcast reconnection
          if (currentRoom) {
            const resultRoom = await pool.query('SELECT name FROM chat_rooms WHERE id = $1', [currentRoom]);
            if (resultRoom.rows.length > 0) {
              ws.send(JSON.stringify({
                type: 'system',
                content: `Reconnected to room: ${resultRoom.rows[0].name}`
              }));

              // Broadcast reconnection to room members
              broadcast({
                type: 'system',
                content: `${currentUser} reconnected to the room`,
                roomId: currentRoom
              }, ws);
            }
          }
        } catch (error) {
          console.error('WebSocket login error:', error);
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Internal server error'
          }));
        }
      } else if (data.type === 'join_room') {
        try {
          const { roomId } = data;
          console.log('Joining room:', { roomId, currentUser }); // Debug log
          
          if (!currentUser) {
            console.log('Cannot join room - user not logged in'); // Debug log
            ws.send(JSON.stringify({
              type: 'error',
              content: 'Please log in first'
            }));
            return;
          }

          // Check if user is a member of the room
          const resultMember = await pool.query('SELECT * FROM room_members WHERE room_id = $1 AND username = $2', [roomId, currentUser]);

          if (resultMember.rows.length === 0) {
            ws.send(JSON.stringify({
              type: 'error',
              content: 'Not a member of this room'
            }));
            return;
          }

          // Update room state
          currentRoom = roomId;
          clients.set(ws, { username: currentUser, room: currentRoom });
          console.log('User joined room:', { currentUser, currentRoom }); // Debug log

          // Get room name and recent messages
          const resultRoom = await pool.query('SELECT name FROM chat_rooms WHERE id = $1', [roomId]);
          const resultMessages = await pool.query(
            'SELECT * FROM messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 50',
            [roomId]
          );
          
          // Send room join confirmation
          ws.send(JSON.stringify({
            type: 'system',
            content: `Joined room: ${resultRoom.rows[0].name}`
          }));

          // Send recent messages
          resultMessages.rows.reverse().forEach(message => {
            ws.send(JSON.stringify({
              type: message.type,
              content: message.content,
              username: message.username,
              roomId: message.room_id,
              timestamp: message.created_at
            }));
          });

          // Broadcast user joined message to room members
          broadcast({
            type: 'system',
            content: `${currentUser} joined the room`,
            roomId
          }, ws);
        } catch (error) {
          console.error('Error joining room via WebSocket:', error);
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Failed to join room. Please try again.'
          }));
        }
      } else if (data.type === 'message' || data.type === 'image' || data.type === 'pdf' || data.type === 'emoji') {
        // Get current room from clients Map and data
        const clientInfo = clients.get(ws);
        const roomId = data.roomId || clientInfo?.room;

        if (!roomId) {
          console.log('Message not processed - missing room:', { clientInfo, data }); // Debug log
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Please join a room first'
          }));
          return;
        }

        if (!currentUser) {
          console.log('Message not processed - user not logged in'); // Debug log
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Please log in first'
          }));
          return;
        }

        // Verify user is a member of the room
        try {
          const resultMember = await pool.query(
            'SELECT * FROM room_members WHERE room_id = $1 AND username = $2',
            [roomId, currentUser]
          );

          if (resultMember.rows.length === 0) {
            console.log('Message not processed - user not a member of room:', { currentUser, roomId }); // Debug log
            ws.send(JSON.stringify({
              type: 'error',
              content: 'You are not a member of this room'
            }));
            return;
          }

          // Update client info with room if needed
          if (!clientInfo?.room) {
            clients.set(ws, { username: currentUser, room: roomId });
            console.log('Updated client room state:', { currentUser, roomId }); // Debug log
          }

          const messageData = {
            ...data,
            username: currentUser,
            roomId: roomId,
            timestamp: new Date()
          };

          console.log('Saving message to database:', { roomId, currentUser, type: data.type, content: data.content }); // Debug log
          
          // Save message to database
          await pool.query(
            'INSERT INTO messages (room_id, username, content, type) VALUES ($1, $2, $3, $4)',
            [roomId, currentUser, data.content, data.type]
          );
          console.log('Message saved successfully'); // Debug log

          // Broadcast message to all clients in the same room
          broadcast(messageData, ws);
          console.log('Message broadcasted to room:', roomId); // Debug log
        } catch (error) {
          console.error('Error processing message:', error);
          ws.send(JSON.stringify({
            type: 'error',
            content: 'Failed to process message'
          }));
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        content: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected:', { currentUser, currentRoom }); // Debug log
    clients.delete(ws);
  });
});

function broadcast(data, exclude = null) {
  wss.clients.forEach((client) => {
    const clientData = clients.get(client);
    if (client !== exclude && 
        client.readyState === WebSocket.OPEN && 
        clientData?.room === data.roomId) {
      client.send(JSON.stringify(data));
    }
  });
}

// Update JWT verification
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Initialize database and start server
initializeDatabase();
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`WebSocket server is ready for connections`);
});

// WebSocket server is already running on wsPort
console.log(`WebSocket server running on port ${wsPort}`); 