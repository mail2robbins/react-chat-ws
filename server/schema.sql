-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create chat_rooms table
CREATE TABLE IF NOT EXISTS chat_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_by TEXT REFERENCES users(username),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create room_members table
CREATE TABLE IF NOT EXISTS room_members (
    room_id INTEGER REFERENCES chat_rooms(id) ON DELETE CASCADE,
    username TEXT REFERENCES users(username) ON DELETE CASCADE,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, username)
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER REFERENCES chat_rooms(id) ON DELETE CASCADE,
    username TEXT REFERENCES users(username) ON DELETE CASCADE,
    content TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
); 