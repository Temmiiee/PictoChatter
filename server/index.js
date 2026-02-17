import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import xss from 'xss-clean';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

// PostgreSQL Pool Configuration
const { Pool } = pg;

let connectionString = process.env.DATABASE_URL;

// Satisfy production SSL warnings (uselibpqcompat and sslmode=require)
if (connectionString && !connectionString.includes('sslmode') && connectionString.includes('render.com')) {
  const separator = connectionString.includes('?') ? '&' : '?';
  connectionString += `${separator}uselibpqcompat=true&sslmode=require`;
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false }
});

// Helper to generate a random 6-digit friend code
const generateFriendCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Initialize PostgreSQL database
const initDB = async () => {
  try {
    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        avatar_data TEXT,
        friend_code TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        room_code TEXT UNIQUE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'text', -- 'text' or 'voice'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        username TEXT NOT NULL,
        message TEXT,
        drawing_data TEXT,
        message_type TEXT DEFAULT 'text',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS room_members (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES rooms(id),
        user_id INTEGER REFERENCES users(id),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(room_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS friendships (
        id SERIAL PRIMARY KEY,
        user1_id INTEGER REFERENCES users(id),
        user2_id INTEGER REFERENCES users(id),
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user1_id, user2_id)
      );

      CREATE TABLE IF NOT EXISTS direct_messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id),
        receiver_id INTEGER REFERENCES users(id),
        message TEXT,
        drawing_data TEXT,
        message_type TEXT DEFAULT 'text',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration: Add friend_code if missing
    await pool.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='friend_code') THEN
          ALTER TABLE users ADD COLUMN friend_code TEXT UNIQUE;
        END IF;
      END $$;
    `);

    // Assign friend codes to users who don't have one
    const usersWithoutCode = await pool.query('SELECT id FROM users WHERE friend_code IS NULL');
    for (const user of usersWithoutCode.rows) {
      let code;
      let isUnique = false;
      while (!isUnique) {
        code = generateFriendCode();
        const existing = await pool.query('SELECT id FROM users WHERE friend_code = $1', [code]);
        if (existing.rows.length === 0) isUnique = true;
      }
      await pool.query('UPDATE users SET friend_code = $1 WHERE id = $2', [code, user.id]);
    }

    // Migration: Add channel_id to messages if missing
    await pool.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='channel_id') THEN
          ALTER TABLE messages ADD COLUMN channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // Migration: Create a "general" channel for every room that has none
    const roomsWithoutChannels = await pool.query(`
      SELECT id FROM rooms r 
      WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.room_id = r.id)
    `);
    
    for (const room of roomsWithoutChannels.rows) {
      await pool.query('INSERT INTO channels (room_id, name, type) VALUES ($1, $2, $3)', [room.id, 'général', 'text']);
      await pool.query('INSERT INTO channels (room_id, name, type) VALUES ($1, $2, $3)', [room.id, 'salon vocal', 'voice']);
    }

    // Migration: Assign messages to the first text channel of their room if channel_id is null
    await pool.query(`
      UPDATE messages m
      SET channel_id = (SELECT c.id FROM channels c WHERE c.room_id = m.room_id AND c.type = 'text' LIMIT 1)
      WHERE m.channel_id IS NULL AND m.room_id IS NOT NULL;
    `);

    console.log('✅ Database initialized and migrated');
  } catch (err) {
    console.error('❌ Database initialization error:', err);
  }
};

initDB();

// Middleware & Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", process.env.CLIENT_URL || "*"]
    }
  }
}));
app.use(hpp()); // Prevent HTTP Parameter Pollution
app.use(xss()); // Sanitize user input from POST body, GET queries, and url params

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, '../client/dist')));

// Helper functions
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// REST API Routes

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const friendCode = generateFriendCode();
    
    // Ensure unique friend code
    let finalCode = friendCode;
    let isUnique = false;
    while (!isUnique) {
      const existing = await pool.query('SELECT id FROM users WHERE friend_code = $1', [finalCode]);
      if (existing.rows.length === 0) isUnique = true;
      else finalCode = generateFriendCode();
    }

    const result = await pool.query(
      'INSERT INTO users (username, password, friend_code) VALUES ($1, $2, $3) RETURNING id',
      [username, hashedPassword, finalCode]
    );
    
    const token = jwt.sign({ id: result.rows[0].id, username }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ 
      token, 
      user: { 
        id: result.rows[0].id, 
        username,
        friend_code: finalCode
      } 
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = userRes.rows[0];
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        username: user.username,
        friend_code: user.friend_code,
        avatar_data: user.avatar_data
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get user's rooms
app.get('/api/rooms', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rooms = await pool.query(`
      SELECT r.*, u.username as creator_name,
        (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
      FROM rooms r
      LEFT JOIN users u ON r.created_by = u.id
      JOIN room_members rm ON r.id = rm.room_id
      WHERE rm.user_id = $1
      ORDER BY r.created_at DESC
    `, [decoded.id]);

    res.json(rooms.rows);
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Create room
app.post('/api/rooms', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name } = req.body;
    let roomCode;
    let attempts = 0;
    
    // Generate unique room code
    do {
      roomCode = generateRoomCode();
      const codeCheck = await pool.query('SELECT id FROM rooms WHERE room_code = $1', [roomCode]);
      if (codeCheck.rows.length === 0) break;
      attempts++;
    } while (attempts < 10);

    const result = await pool.query(
      'INSERT INTO rooms (name, room_code, created_by) VALUES ($1, $2, $3) RETURNING id',
      [name, roomCode, decoded.id]
    );
    const roomId = result.rows[0].id;
    
    // Create default channels
    await pool.query('INSERT INTO channels (room_id, name, type) VALUES ($1, $2, $3)', [roomId, 'général', 'text']);
    await pool.query('INSERT INTO channels (room_id, name, type) VALUES ($1, $2, $3)', [roomId, 'salon vocal', 'voice']);
    
    // Add creator as member
    await pool.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, decoded.id]);

    const room = await pool.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
    
    res.json(room.rows[0]);
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Channels API
app.get('/api/rooms/:roomId/channels', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const { roomId } = req.params;
    const channels = await pool.query('SELECT * FROM channels WHERE room_id = $1 ORDER BY created_at ASC', [roomId]);
    res.json(channels.rows);
  } catch (error) {
    console.error('Get channels error:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

app.post('/api/rooms/:roomId/channels', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const { roomId } = req.params;
    const { name, type } = req.body;
    
    const room = await pool.query('SELECT created_by FROM rooms WHERE id = $1', [roomId]);
    if (room.rows[0].created_by !== decoded.id) {
      return res.status(403).json({ error: 'Only creator can add channels' });
    }

    const result = await pool.query(
      'INSERT INTO channels (room_id, name, type) VALUES ($1, $2, $3) RETURNING *',
      [roomId, name, type || 'text']
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create channel error:', error);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// Join room by code
app.post('/api/rooms/join', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { roomCode } = req.body;
    const roomRes = await pool.query('SELECT * FROM rooms WHERE room_code = $1', [roomCode]);
    const room = roomRes.rows[0];
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if already a member
    const existingMember = await pool.query('SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2', [room.id, decoded.id]);
    
    if (existingMember.rows.length === 0) {
      await pool.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [room.id, decoded.id]);
    }

    res.json(room);
  } catch (error) {
    console.error('Join room error:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Get channel messages
app.get('/api/channels/:channelId/messages', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const { channelId } = req.params;
    const channel = await pool.query('SELECT room_id FROM channels WHERE id = $1', [channelId]);
    if (channel.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
    
    const roomId = channel.rows[0].room_id;
    const isMember = await pool.query('SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, decoded.id]);
    if (isMember.rows.length === 0) return res.status(403).json({ error: 'Not a member' });

    const messages = await pool.query(`
      SELECT m.*, u.avatar_data
      FROM messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.channel_id = $1 
      ORDER BY m.created_at DESC 
      LIMIT 100
    `, [channelId]);

    res.json(messages.rows.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Backward compatibility: Get room messages (from first text channel)
app.get('/api/rooms/:roomId/messages', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const { roomId } = req.params;
    const channel = await pool.query("SELECT id FROM channels WHERE room_id = $1 AND type = 'text' ORDER BY created_at ASC LIMIT 1", [roomId]);
    if (channel.rows.length === 0) return res.json([]);
    
    const messages = await pool.query(`
      SELECT m.*, u.avatar_data
      FROM messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.channel_id = $1 
      ORDER BY m.created_at DESC 
      LIMIT 100
    `, [channel.rows[0].id]);

    res.json(messages.rows.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Update profile
app.patch('/api/users/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const { avatar_data } = req.body;
    await pool.query('UPDATE users SET avatar_data = $1 WHERE id = $2', [avatar_data, decoded.id]);
    
    res.json({ success: true, avatar_data });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Delete profile
app.delete('/api/users/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    // Delete everything related to the user
    await pool.query('DELETE FROM room_members WHERE user_id = $1', [decoded.id]);
    await pool.query('DELETE FROM messages WHERE user_id = $1', [decoded.id]);
    await pool.query('DELETE FROM friendships WHERE user1_id = $1 OR user2_id = $1', [decoded.id]);
    await pool.query('DELETE FROM direct_messages WHERE sender_id = $1 OR receiver_id = $1', [decoded.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [decoded.id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete profile error:', error);
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

// Friends API
app.get('/api/friends', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const friends = await pool.query(`
      SELECT u.id, u.username, u.avatar_data, f.status
      FROM users u
      JOIN friendships f ON (f.user1_id = u.id OR f.user2_id = u.id)
      WHERE (f.user1_id = $1 OR f.user2_id = $1) AND u.id != $1
    `, [decoded.id]);

    res.json(friends.rows);
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

app.post('/api/friends/add', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const { identifier } = req.body; // username or friend_code
    const targetUser = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR friend_code = $1',
      [identifier]
    );
    
    if (targetUser.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const targetId = targetUser.rows[0].id;
    if (targetId === decoded.id) return res.status(400).json({ error: 'Cannot add yourself' });

    const user1 = Math.min(decoded.id, targetId);
    const user2 = Math.max(decoded.id, targetId);

    await pool.query(
      'INSERT INTO friendships (user1_id, user2_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [user1, user2, 'pending']
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Add friend error:', error);
    res.status(500).json({ error: 'Failed to add friend' });
  }
});

app.post('/api/friends/accept', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const { friendId } = req.body;
    const user1 = Math.min(decoded.id, friendId);
    const user2 = Math.max(decoded.id, friendId);

    await pool.query(
      "UPDATE friendships SET status = 'accepted' WHERE user1_id = $1 AND user2_id = $2",
      [user1, user2]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Accept friend error:', error);
    res.status(500).json({ error: 'Failed to accept friend' });
  }
});

// Direct Messages API
app.get('/api/direct-messages/:friendId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const { friendId } = req.params;
    const messages = await pool.query(`
      SELECT dm.*, u.username, u.avatar_data, dm.sender_id as user_id
      FROM direct_messages dm
      JOIN users u ON dm.sender_id = u.id
      WHERE (dm.sender_id = $1 AND dm.receiver_id = $2) OR (dm.sender_id = $2 AND dm.receiver_id = $1)
      ORDER BY dm.created_at ASC
      LIMIT 100
    `, [decoded.id, friendId]);

    res.json(messages.rows);
  } catch (error) {
    console.error('Get DMs error:', error);
    res.status(500).json({ error: 'Failed to fetch DMs' });
  }
});

// Socket.io connection handling
const onlineUsers = new Map(); // userId -> socketId
const voiceUsers = new Map(); // channelId -> Set of userIds (or 'dm_id' for private calls)

const getVoiceParticipants = (channelId) => {
  const users = voiceUsers.get(channelId) || new Set();
  const participants = [];
  
  users.forEach(userId => {
    // Try to find the username from onlineUsers mapping
    // We might need a separate userIdToUsername map if onlineUsers only stores socketId
    // For now, let's assume we can find it or just store it in voiceUsers
    participants.push({ id: userId, username: socketIdToUsername.get(onlineUsers.get(userId)) || 'Direct' });
  });
  return participants;
};

const socketIdToUsername = new Map(); // socketId -> username

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('authenticate', (token) => {
    const decoded = verifyToken(token);
    if (decoded) {
      socket.userId = decoded.id;
      socket.username = decoded.username;
      onlineUsers.set(decoded.id, socket.id);
      socketIdToUsername.set(socket.id, decoded.username);
      console.log('User authenticated:', socket.username);
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      socketIdToUsername.delete(socket.id);
      
      // Remove from all voice channels
      voiceUsers.forEach((users, channelId) => {
        if (users.has(socket.userId)) {
          users.delete(socket.userId);
          if (users.size === 0) voiceUsers.delete(channelId);
          
          const participants = getVoiceParticipants(channelId);
          io.emit('voice_users_update', { channelId, participants });
          socket.to(`voice_${channelId}`).emit('user_left_voice', { userId: socket.userId });
        }
      });
    }
    console.log('User disconnected:', socket.id);
  });

  socket.on('join_room', (roomId) => {
    socket.join(`room_${roomId}`);
    console.log(`${socket.username} joined room ${roomId}`);
    
    // Notify others in the room
    socket.to(`room_${roomId}`).emit('user_joined', {
      username: socket.username,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('leave_room', (roomId) => {
    socket.leave(`room_${roomId}`);
    console.log(`${socket.username} left room ${roomId}`);
    
    socket.to(`room_${roomId}`).emit('user_left', {
      username: socket.username,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('join_channel', (channelId) => {
    socket.join(`channel_${channelId}`);
    console.log(`${socket.username} joined channel ${channelId}`);
  });

  socket.on('leave_channel', (channelId) => {
    socket.leave(`channel_${channelId}`);
  });

  // Voice Chat
  socket.on('join_voice', (channelId) => {
    socket.join(`voice_${channelId}`);
    
    if (!voiceUsers.has(channelId)) voiceUsers.set(channelId, new Set());
    voiceUsers.get(channelId).add(socket.userId);

    const participants = getVoiceParticipants(channelId);
    io.emit('voice_users_update', { channelId, participants });

    socket.to(`voice_${channelId}`).emit('user_joined_voice', { 
      userId: socket.userId, 
      username: socket.username 
    });
  });

  socket.on('leave_voice', (channelId) => {
    socket.leave(`voice_${channelId}`);
    
    if (voiceUsers.has(channelId)) {
      voiceUsers.get(channelId).delete(socket.userId);
      if (voiceUsers.get(channelId).size === 0) voiceUsers.delete(channelId);
    }

    const participants = getVoiceParticipants(channelId);
    io.emit('voice_users_update', { channelId, participants });

    socket.to(`voice_${channelId}`).emit('user_left_voice', { 
      userId: socket.userId 
    });
  });

  socket.on('start_private_call', (data) => {
    const { targetUserId } = data;
    const callId = `dm_${Math.min(socket.userId, targetUserId)}_${Math.max(socket.userId, targetUserId)}`;
    socket.join(callId);
    
    const targetSocketId = onlineUsers.get(parseInt(targetUserId));
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming_call', { 
        userId: socket.userId, 
        username: socket.username,
        callId
      });
    }
  });

  socket.on('accept_call', (data) => {
    const { callId, targetUserId } = data;
    socket.join(callId);
    const targetSocketId = onlineUsers.get(parseInt(targetUserId));
    if (targetSocketId) {
      io.to(targetSocketId).emit('call_accepted', { userId: socket.userId, callId });
    }
  });

  socket.on('voice_signal', (data) => {
    const { targetUserId, signal } = data;
    const targetSocketId = onlineUsers.get(parseInt(targetUserId));
    if (targetSocketId) {
      io.to(targetSocketId).emit('voice_signal', {
        userId: socket.userId,
        signal
      });
    }
  });

  socket.on('send_message', async (data) => {
    try {
      const { roomId, channelId, friendId, message, drawingData, messageType } = data;
      
      if (!socket.userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }

      if (channelId) {
        // Channel Message
        const result = await pool.query(`
          INSERT INTO messages (room_id, channel_id, user_id, username, message, drawing_data, message_type) 
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, created_at
        `, [roomId || null, channelId, socket.userId, socket.username, message || null, drawingData || null, messageType || 'text']);

        const messageData = {
          id: result.rows[0].id,
          room_id: roomId,
          channel_id: channelId,
          user_id: socket.userId,
          username: socket.username,
          message: message || null,
          drawing_data: drawingData || null,
          message_type: messageType || 'text',
          created_at: result.rows[0].created_at
        };

        io.to(`channel_${channelId}`).emit('new_message', messageData);
      } else if (friendId) {
        // Direct Message
        const result = await pool.query(`
          INSERT INTO direct_messages (sender_id, receiver_id, message, drawing_data, message_type) 
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, created_at
        `, [socket.userId, friendId, message || null, drawingData || null, messageType || 'text']);

        const messageData = {
          id: result.rows[0].id,
          sender_id: socket.userId,
          receiver_id: friendId,
          user_id: socket.userId, // Added for frontend compatibility
          username: socket.username,
          message: message || null,
          drawing_data: drawingData || null,
          message_type: messageType || 'text',
          created_at: result.rows[0].created_at
        };

        socket.emit('new_direct_message', messageData);
        const receiverSocketId = onlineUsers.get(parseInt(friendId));
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('new_direct_message', messageData);
        }
      }
    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('typing', (data) => {
    const { channelId, friendId, isTyping } = data;
    if (channelId) {
      socket.to(`channel_${channelId}`).emit('user_typing', { username: socket.username, isTyping });
    } else if (friendId) {
      const receiverSocketId = onlineUsers.get(parseInt(friendId));
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('user_typing', { username: socket.username, isTyping, friendId: socket.userId });
      }
    }
  });
});

// Serve client in production
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../client/dist/index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`🚀 PictoChatter server running on port ${PORT}`);
});
