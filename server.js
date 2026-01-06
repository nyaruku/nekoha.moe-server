import mysql from 'mysql2';
import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import crypto from 'node:crypto';
import path from 'path';
import { format } from 'date-fns';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import { Server } from "socket.io";


dotenv.config({ path: 'secret.env' });

const algorithm = "aes-256"
const secretKey = process.env.ENCRYPT_STRING

const key = crypto
  .createHash("sha512")
  .update(secretKey)
  .digest("hex")
  .substring(0, 32)

const iv = crypto.randomBytes(16)

function encrypt(data) {
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv)
  let encrypted = cipher.update(data, "utf-8", "hex")
  encrypted += cipher.final("hex")

  return iv.toString("hex") + encrypted
}

function decrypt(data) {
  const inputIV = data.slice(0, 32)
  const encrypted = data.slice(32)
  const decipher = crypto.createDecipheriv(
    algorithm,
    Buffer.from(key),
    Buffer.from(inputIV, "hex"),
  )
  let decrypted = decipher.update(encrypted, "hex", "utf-8")
  decrypted += decipher.final("utf-8")
  return decrypted
}


const allowedChannels = [
  'announce', 'arabic', 'balkan', 'bulgarian', 'cantonese', 'chinese', 'ctb', 'czechoslovak',
  'dutch', 'english', 'estonian', 'filipino', 'finnish', 'french', 'german', 'greek', 'hebrew',
  'help', 'hungarian', 'indonesian', 'italian', 'japanese', 'korean', 'latvian', 'lazer',
  'lobby', 'malaysian', 'mapping', 'modreqs', 'osu', 'osumania', 'polish', 'portuguese',
  'romanian', 'russian', 'skandinavian', 'spanish', 'taiko', 'taiwanese', 'thai', 'turkish',
  'ukrainian', 'uzbek', 'videogames', 'vietnamese'
];

// Helper function to format Unix epoch timestamps
const formatTimestamp = (epochMs) => {
  if (!epochMs || isNaN(epochMs)) return ''; // Handle invalid timestamps
  return format(new Date(parseInt(epochMs)), 'dd.MM.yyyy - HH:mm:ss');
};

// ####################################
//     DATABASE & SERVER CONNECTION
// ####################################

const db = new pg.Pool({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PW,
  database: process.env.PG_NAME_LOGGER,
  port: process.env.PG_PORT,
  max: 1000,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 2000,
});

const db_nekoha = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PW,
  database: process.env.DB_NAME_MAIN,

  waitForConnections: true,
  connectionLimit: 1000,
  maxIdle: 1000,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// PostgreSQL database connection test
db.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL:', err);
    return;
  }
  console.log('Connected to PostgreSQL (Connection Pool)');
  release(); // release the client back to the pool
});


// Server Connection
const app = express();
const port = 5000;
const server = http.createServer(app);

// CORS middleware for cross-origin requests
app.use(cors());

// ###########################
//       API Endpoints
// ###########################

app.get('/api/log', (req, res) => {
  
  let channel = req.query.channel ? req.query.channel : 'osu'; // Default to 'osu'

  if (!allowedChannels.includes(channel) && !(channel == "allm")) {
    return res.status(400).send('Invalid channel');
  }

  // Parse user_id: support single or multiple comma-separated IDs
  let userIds = [];
  if (req.query.user_id) {
    userIds = req.query.user_id
      .split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !isNaN(id) && id > 0);
  }

  let username = req.query.username ? req.query.username.trim() : null;
  let messageFilter = req.query.message ? req.query.message : null;
  let timeStart = parseInt(req.query.start, 10);
  let timeEnd = parseInt(req.query.end, 10);
  let limit = parseInt(req.query.limit, 10); // Ensure it's an integer
  let offset = parseInt(req.query.offset, 10) || 0; // Default offset
  let sort = req.query.sort;

  let query = "";
  let conditions = [];
  let params = [];

    let paramIndex = 1;

    if (userIds.length > 0) {
        let userPlaceholders = userIds.map(() => `$${paramIndex++}`).join(',');
        conditions.push(`user_id IN (${userPlaceholders})`);
        params.push(...userIds);
    }

    if (username) {
    conditions.push(`username = $${paramIndex++}`);
    params.push(username);
    }

    if (messageFilter) {
    conditions.push(`message LIKE $${paramIndex++}`);
    params.push(`%${messageFilter}%`);
    }

    if (!isNaN(timeStart)) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    params.push(timeStart);
    }

    if (!isNaN(timeEnd)) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    params.push(timeEnd);
    }

  let whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

  query = `SELECT * FROM ${channel} ${whereClause}`;

  if (sort === "asc" || sort === "desc") {
    query += ` ORDER BY id ${sort}`;
  } else {
    query += " ORDER BY id ASC";
  }

  if (!isNaN(limit) && limit >= 100 && limit <= 50000 ) {
    query += ` LIMIT ${limit}`;
  } else {
    query += ` LIMIT 10000`;
  }

  if (!isNaN(offset) && offset > 0) {
    query += ` OFFSET ${offset}`;
  }

  // console.log("Executing query:", query);
  // console.log("With parameters:", params);

  db.query(query, params, (err, result) => {
    if (err) {
      console.error("Error fetching entries:", err);
      res.status(500).send("Error fetching chat");
      return;
    }
    const normalizedRows = result.rows.map(r => ({
        ...r,
        id: parseInt(r.id, 10),
        user_id: parseInt(r.user_id, 10),
        timestamp: parseInt(r.timestamp, 10),
        message: r.message || ''
    }));
    res.json(normalizedRows);
  });
});

app.get('/api/log/stats', async (req, res) => {
  try {
    // total messages and unique users
    const totalRowsResult = await db.query(`SELECT COUNT(*) AS total FROM allm`);
    const uniqueUsersResult = await db.query(`SELECT COUNT(*) AS unique_users FROM latest_usernames`);

    const totalRowCount = parseInt(totalRowsResult.rows[0].total, 10);
    const uniqueUsersCount = parseInt(uniqueUsersResult.rows[0].unique_users, 10);

    // table info
    const tableQuery = `
      SELECT
        table_name AS "tableName",
        pg_total_relation_size(quote_ident(table_name)) AS "sizeMB",
        (SELECT reltuples::bigint FROM pg_class WHERE relname = table_name) AS "rowCount"
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY "rowCount" DESC;
    `;

    const tableResults = await db.query(tableQuery);

    const filteredResults = tableResults.rows
      .filter(t => t.tableName !== 'latest_usernames')
      .map(t => ({
        tableName: t.tableName,
        rowCount: parseInt(t.rowCount ?? 0, 10),
        allocated_mb: parseInt(t.sizeMB ?? 0, 10)  // keep it in bytes
      }));

    // total allocated
    const totalSize = filteredResults.reduce((sum, t) => sum + t.allocated_mb, 0);

    const actualSizeBytes = 0; // Docker container cannot access actual disk usage

    const tables = filteredResults.map(t => ({
        tableName: t.tableName,       // keep the correct key
        rowCount: t.rowCount,         // match front-end expectation
        sizeMB: t.allocated_mb   // already computed in filteredResults
    }));

    res.json({
        totalRowCount: totalRowCount,
        uniqueUsers: uniqueUsersCount,
        tables,
        totalDatabaseSizeBytes: totalSize,
        actualDiskAllocBytes: actualSizeBytes,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/log/stats-graph', async (req, res) => {
  const channel = req.query.channel;
  const rawStart = req.query.start;
  const rawEnd = req.query.end;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100); // default 50, max 100

  if (!allowedChannels.includes(channel) && channel !== "allm") {
    return res.status(400).json({ error: 'Invalid channel name' });
  }

  const timeStart = !isNaN(parseInt(rawStart)) ? parseInt(rawStart, 10) : 0;
  const timeEnd = !isNaN(parseInt(rawEnd)) ? parseInt(rawEnd, 10) : Date.now();

  if (timeStart > timeEnd) {
    return res.status(400).json({ error: 'Start time must be before end time' });
  }

  try {
    // Postgres uses $1, $2 for placeholders
    const params = [timeStart, timeEnd];

    const userSql = `
    SELECT 
        u.username,
        t.message_count
    FROM (
        SELECT 
        m.user_id,
        COUNT(*)::int AS message_count
        FROM "${channel}" m
        WHERE m.timestamp BETWEEN $1 AND $2
        GROUP BY m.user_id
        ORDER BY message_count DESC
        LIMIT ${limit}
    ) AS t
    JOIN latest_usernames u ON u.user_id = t.user_id;
    `;

    const cacheSql = `
      SELECT top_words
      FROM word_frequency_cache
      WHERE channel = $1
    `;

    // Run first query (user message counts)
    const userResults = (await db.query(userSql, params)).rows.map(r => ({
        username: r.username,
        message_count: parseInt(r.message_count, 10)
    }));

    // Run second query (cached top words)
    const cacheResults = (await db.query(cacheSql, [channel])).rows;

    let topWords = [];
    if (cacheResults.length > 0 && cacheResults[0].top_words) {
      const cachedString = cacheResults[0].top_words.trim();
      topWords = cachedString.split(' ').map(pair => {
        const [countStr, ...wordParts] = pair.split(':');
        return {
          username: wordParts.join(':'),
          message_count: parseInt(countStr, 10)
        };
      });
    }

    res.json({
      users: userResults,
      top_words: topWords,
    });
  } catch (err) {
    console.error('Stats-graph query error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// app.get('/api/log/export', (req, res) => {
//   const fileName = `chat_log_pgsql_${Date.now()}.sql`;
//   const filePath = path.join(__dirname, 'backups', fileName);

//   // Ensure the backups directory exists
//   if (!fs.existsSync(path.dirname(filePath))) {
//     fs.mkdirSync(path.dirname(filePath), { recursive: true });
//   }

//   // Create PostgreSQL dump command
//   // Using PGPASSWORD environment variable for password
//   const dumpCommand = `PGPASSWORD='${process.env.PG_PW}' pg_dump --username=${process.env.PG_USER} --host=${process.env.PG_HOST} --format=plain --no-owner --no-privileges ${process.env.PG_NAME_LOGGER} > ${filePath}`;

//   exec(dumpCommand, (error, stdout, stderr) => {
//     if (error) {
//       console.error('Error exporting PostgreSQL database:', error, stderr);
//       return res.status(500).json({ error: 'Failed to export database' });
//     }

//     // Send the backup file to the client
//     res.download(filePath, fileName, (err) => {
//       if (err) {
//         console.error('Error sending file:', err);
//         return res.status(500).json({ error: 'Failed to send database backup' });
//       }

//       // Delete the file after download
//       fs.unlink(filePath, (unlinkErr) => {
//         if (unlinkErr) {
//           console.error('Error deleting backup file:', unlinkErr);
//         }
//       });
//     });
//   });
// });

// Function to format each row with fixed column widths
const formatRow = (timestamp, user_id, username, message) => {
  return `${timestamp.padEnd(22)} ${user_id.toString().padEnd(10)} ${username.padEnd(16)} ${message}`;
};

// // API to export a single table as CSV/TXT
// app.get('/api/log/download', async (req, res) => {
//   const channel = req.query.channel ? req.query.channel : 'osu'; // Default to 'osu'

//   if (!allowedChannels.includes(channel) && channel !== "allm") {
//     return res.status(400).send('Invalid channel');
//   }

//   const fileName = `chat_log_${channel}_${Date.now()}.txt`;
//   const filePath = path.join(__dirname, 'backups', fileName);

//   // Ensure the backups directory exists
//   if (!fs.existsSync(path.dirname(filePath))) {
//     fs.mkdirSync(path.dirname(filePath), { recursive: true });
//   }

//   const writeStream = fs.createWriteStream(filePath);

//   // Use parameterized query syntax for Postgres
//   const queryText = `SELECT timestamp, user_id, username, message FROM "${channel}"`;

//   db.query(queryText, [], (err, result) => {
//     if (err) {
//       console.error(`Error exporting table ${channel}:`, err);
//       return res.status(500).json({ error: `Failed to export table: ${channel}` });
//     }

//     const rows = result.rows.map(r => ({
//         timestamp: parseInt(r.timestamp, 10),
//         user_id: parseInt(r.user_id, 10),
//         username: r.username || '',
//         message: r.message || ''
//     }));

//     // Write headers
//     if (rows.length > 0) {
//       writeStream.write(formatRow("timestamp", "user_id", "username", "message") + '\n');
//     }

//     rows.forEach(row => {
//       writeStream.write(formatRow(
//         formatTimestamp(row.timestamp),
//         row.user_id,
//         row.username,
//         row.message
//       ) + '\n');
//     });

//     writeStream.end();

//     writeStream.on('finish', () => {
//       res.download(filePath, fileName, (err) => {
//         if (err) {
//           console.error('Error sending file:', err);
//           return res.status(500).json({ error: 'Failed to send TXT file' });
//         }

//         // Delete file after download
//         fs.unlink(filePath, (unlinkErr) => {
//           if (unlinkErr) {
//             console.error('Error deleting TXT file:', unlinkErr);
//           }
//         });
//       });
//     });

//     writeStream.on('error', (err) => {
//       console.error('Error writing TXT file:', err);
//       return res.status(500).json({ error: 'Failed to write TXT file' });
//     });
//   });
// });

// GET + increment visit counter
app.get('/api/visit', (req, res) => {
  const query = 'UPDATE data SET counter = counter + 1';
  db_nekoha.query(query, (err) => {
    if (err) return res.status(500).send('Database error');
    
    db_nekoha.query('SELECT counter FROM data', (err, results) => {
      if (err) return res.status(500).send('Read error');
      res.json({ count: results[0].counter });
    });
  });
});


app.get('/api/log/info', async (req, res) => {
  const channel = req.query.channel;
  const rawStart = req.query.start;
  const rawEnd = req.query.end;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 15, 100); // max 100 per page

  if (!allowedChannels.includes(channel) && channel !== "allm") {
    return res.status(400).json({ error: 'Invalid channel name' });
  }

  const timeStart = !isNaN(parseInt(rawStart)) ? parseInt(rawStart, 10) : null;
  const timeEnd = !isNaN(parseInt(rawEnd)) ? parseInt(rawEnd, 10) : null;

  if (timeStart !== null && timeEnd !== null && timeStart > timeEnd) {
    return res.status(400).json({ error: 'Start time must be before end time' });
  }

  const offset = (page - 1) * pageSize;
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (timeStart !== null) {
    conditions.push(`m.timestamp >= $${paramIndex++}`);
    params.push(timeStart);
  }
  if (timeEnd !== null) {
    conditions.push(`m.timestamp <= $${paramIndex++}`);
    params.push(timeEnd);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : '';

  // Count total distinct users
  const countSql = `
    SELECT COUNT(DISTINCT m.user_id) AS total
    FROM "${channel}" m
    ${whereClause}
  `;

  // User message counts with pagination
  const dataSql = `
    SELECT
      t.user_id,
      u.username,
      t.message_count
    FROM (
      SELECT 
        m.user_id,
        COUNT(*) AS message_count
      FROM "${channel}" m
      ${whereClause}
      GROUP BY m.user_id
      ORDER BY message_count DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    ) AS t
    LEFT JOIN latest_usernames u ON t.user_id = u.user_id
    ORDER BY t.message_count DESC
  `;

  params.push(pageSize, offset); // push limit and offset as last parameters

  // Table stats query
  const tableStatsSql = `
    SELECT 
      table_name,
      pg_total_relation_size(quote_ident(table_name)) AS size_bytes,
      (SELECT reltuples::bigint FROM pg_class WHERE relname = table_name) AS row_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name != 'latest_usernames'
  `;

  try {
    const countParams = [];
    if (timeStart !== null) countParams.push(timeStart);
    if (timeEnd !== null) countParams.push(timeEnd);
    const totalResult = await db.query(countSql, countParams);

    const total = totalResult.rows[0].total;

    const dataResult = await db.query(dataSql, params);
    const tableStatsResult = await db.query(tableStatsSql);

    const items = dataResult.rows.map(r => ({
        user_id: parseInt(r.user_id, 10),
        message_count: parseInt(r.message_count, 10),
        username: r.username || ''
    }));

    const tableStats = tableStatsResult.rows.map(t => ({
        table_name: t.table_name,
        row_count: parseInt(t.row_count, 10),
        allocated_mb: parseFloat((t.size_bytes / 1024 / 1024).toFixed(2))
    }));

    res.json({
        items,
        total,
        tableStats
    });
  } catch (err) {
    console.error('Error in /api/log/info:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});






























// #####################
//     CHAT WEBSITE
// #####################

let onlineCount = 0;

// Fetch last 24h Chat Messages
app.get('/api/chat', (req, res) => {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  //const query = 'SELECT * FROM chat WHERE timestamp >= ? ORDER BY id ASC';
  //const query = 'SELECT * FROM chat ORDER BY id DESC';
  const query = `
  SELECT id, timestamp, username, message, color, discord
  FROM chat
  WHERE timestamp >= ?
  ORDER BY id DESC`;

  db_nekoha.query(query, [oneDayAgo], (err, results) => {
    if (err) {
      console.error('Error fetching messages:', err);
      return res.status(500).send('Error fetching messages');
    }
    res.json(results);
  });
});

// Add middleware to parse JSON bodies
app.use(express.json()); // This is required for parsing JSON data


const chatLimiter = rateLimit({
  windowMs: 3000, // 3 seconds
  max: 6, // limit each IP to x requests per windowMs
  message: 'Too many messages sent, please slow down.'
});

// Store New Chat Message
app.post('/api/chat', ipConnectionGuard, chatLimiter, (req, res) => {

  const errMsg = {
    reason: "You are not connected",
  };

  if (!ipConnections[req.ip]) {
    return res.status(403).json(errMsg);
  }

  const unixTimeMs = Date.now();

  // Clean inputs
  let { username, message, color } = req.body;

  // Strip invisible characters from username and message (including zero-width spaces)
  const stripInvisibleChars = (str) => {
    return str.replace(/[\u200B-\u200D\uFEFF]/g, ''); // This regex removes zero-width spaces and other invisible characters
  };

  // Validate and sanitize message
  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).send('Message is required');
  }

  // Strip invisible characters from message
  message = stripInvisibleChars(message.trim().slice(0, 2000));
  // Ensure message is a string
  if (typeof message !== 'string' || message === '') {
    return res.status(400).send('Message is invalid');
  }

  // Strip invisible characters from username if it exists
  username = username ? stripInvisibleChars(username.trim().slice(0, 20)) : null;
  
  // Validate username (strip empty username)
  if (username === '') {
    username = null;
  }

  // Sanitize username for XSS (replace < and > with HTML-safe characters)
  username = username ? username.replace(/</g, '&lt;').replace(/>/g, '&gt;') : null;

  // Validate color (hexadecimal color validation)
  color = typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/i.test(color) ? color : '#FFFFFF';

  let discord = 0;

  // Prepare the SQL query
  const query = `
    INSERT INTO chat (timestamp, username, message, color, discord, ip)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const values = [unixTimeMs, username, message, color, discord, req.ip];

  db_nekoha.query(query, values, (err, result) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Database error');
    }

    const newMessage = {
      id: result.insertId,
      timestamp: unixTimeMs,
      username: username || 'anonymous',
      message,
      color,
      discord
    };

    // Notify chat clients about the new message
    notifyChatClients(newMessage);

    // Return the new message with a successful status
    res.status(201).json(newMessage);
  });
});



function ipConnectionGuard(req, res, next) {
  const ip = req.ip;

  if (ipConnections[ip] > MAX_CONNECTIONS_PER_IP) {
    console.log(`Blocked POST /api/chat from ${ip} due to too many connections.`);
    return res.status(429).json({ error: 'Too many active connections from your IP. Try again later.' });
  }

  next();
}

app.set('trust proxy', true);

const io = new Server(server, {
  path: "/api/live/",
});

// Create a namespace for chat
const chatNamespace = io.of("/web-chat");

const ipConnections = {};
const MAX_CONNECTIONS_PER_IP = 3;

// Keep track of the uptime
setInterval(() => {
  const uptime = getUptime();
  chatNamespace.emit('uptime', uptime); // Emit the uptime data to all clients
}, 1000);

const messageTimestamps = new Map();

chatNamespace.on('connection', (socket) => {

  const token = socket.handshake.query?.token;
  const isBot = token === process.env.BOT_SOCKET_SECRET;
  console.log('Received token:', token);
  console.log(process.env.BOT_SOCKET_SECRET);
  console.log(isBot);

  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : socket.handshake.address;

  if (!isBot) {
    ipConnections[ip] = (ipConnections[ip] || 0) + 1;

    if (ipConnections[ip] > MAX_CONNECTIONS_PER_IP) {
      console.log(`Too many connections from ${ip}. Disconnecting socket.`);
      socket.disconnect(true);
      ipConnections[ip]--;
      return;
    }
  }

  onlineCount++;
  console.log('New WebSocket client connected');
  // Broadcast the new count to all clients
  chatNamespace.emit('user_count', onlineCount);

  // Listen for a 'disconnect' event
  socket.on('disconnect', () => {
    onlineCount--;
    chatNamespace.emit('user_count', onlineCount);
    if (!isBot) {
      messageTimestamps.delete(socket.id);
      ipConnections[ip] = Math.max((ipConnections[ip] || 1) - 1, 0);
      if (ipConnections[ip] === 0) delete ipConnections[ip];
    }
  });

  // Listen for errors
  socket.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  const MESSAGE_LIMIT = 2;
  const TIME_WINDOW = 3000; // 3 seconds

  socket.on('new_message', (message) => {
    // Ensure the message is a string and not an object or any unexpected type
    if(!isBot){
      if (typeof message !== 'string') {
        console.log(`Invalid message payload from ${ip}. Disconnecting socket.`);
        socket.disconnect(true);
        return;
      }

      // Strip invisible characters (e.g., zero-width space) and sanitize message
      message = message.replace(/[\u200B-\u200D\uFEFF]/g, ''); // Remove zero-width spaces
      message = message.trim(); // Clean the message by trimming whitespace

      if (message.length === 0) {
        console.log(`Empty message received from ${ip}. Disconnecting socket.`);
        socket.disconnect(true);
        return;
      }

      // Enforce message length limit (e.g., 2000 characters)
      if (message.length > 2000) {
        message = message.slice(0, 2000); // Truncate if message exceeds limit
      }
    }
    if (!isBot) {
      const now = Date.now();
      const timestamps = messageTimestamps.get(socket.id) || [];
      const recent = timestamps.filter(ts => now - ts < TIME_WINDOW);
      recent.push(now);
      messageTimestamps.set(socket.id, recent);

      if (recent.length > MESSAGE_LIMIT) {
        console.log(`Rate limit exceeded by ${ip}. Disconnecting socket.`);
        socket.disconnect(true);
        return;
      }
    }

    // Broadcast the sanitized and validated message to all other clients
    socket.broadcast.emit('new_message',message);
  });

});


// Function to broadcast to all clients in the chat namespace
function notifyChatClients(messageObject) {
  // Emit the 'new_message' event to all connected clients in the chat namespace
  chatNamespace.emit('new_message', messageObject);  // This will broadcast to all clients connected to /web-chat
}

setInterval(() => {
  const TIME_WINDOW = 3000; // 3 seconds
  const now = Date.now();
  for (const [id, timestamps] of messageTimestamps.entries()) {
    const recent = timestamps.filter(ts => now - ts < TIME_WINDOW);
    if (recent.length === 0) {
      messageTimestamps.delete(id);
    } else {
      messageTimestamps.set(id, recent);
    }
  }
}, 5000);

// ###########################
//           UPTIME
// ###########################

// Capture the start time when the server is initialized
const serverStartTime = Date.now();

// Function to calculate and format uptime
function getUptime() {
  const uptimeInMilliseconds = Date.now() - serverStartTime;
  const uptimeInSeconds = Math.floor(uptimeInMilliseconds / 1000);
  return formatUptime(uptimeInSeconds);
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / (24 * 3600));
  const hours = Math.floor((seconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
}

// ###########################
//        CURSOR SYNC
// ###########################

const app_cursor = express();
const port_cursor = 5002;
const server_cursor = http.createServer(app_cursor);

// CORS middleware for cross-origin requests
app_cursor.use(cors());
app_cursor.set('trust proxy', true);


const io_cursor = new Server(server_cursor, {
  path: "/api/live/cursor-ws/",
});

const cursorNamespace = io_cursor.of('/cursor-sync');

const MAX_CONNECTIONS_PER_IP_CURSOR = 2; // if user is curious
const ipConnectionsCursor = {};
const activeCursors = {};  // { socket.id: { x, y } }

cursorNamespace.on('connection', (socket) => {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : socket.handshake.address;

  ipConnectionsCursor[ip] = (ipConnectionsCursor[ip] || 0) + 1;

  if (ipConnectionsCursor[ip] > MAX_CONNECTIONS_PER_IP_CURSOR) {
    console.log(`Too many cursor connections from ${ip}. Disconnecting socket.`);
    socket.disconnect(true);
    ipConnectionsCursor[ip]--;
    return;
  }

  console.log(`Cursor client connected: ${socket.id} from ${ip}`);

  // Store last send timestamp for throttling
  let lastSent = 0;

  socket.on('cursor_position', (data) => {
    const now = Date.now();
    if (now - lastSent >= 20) {
      lastSent = now;

      const name = typeof data.name === 'string' ? data.name.substring(0, 20) : 'Anonymous';

      activeCursors[socket.id] = {
        x: data.x,
        y: data.y,
        name,
      };

      socket.broadcast.emit('cursor_position', {
        id: socket.id,
        x: data.x,
        y: data.y,
        name,
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Cursor client disconnected: ${socket.id}`);
    delete activeCursors[socket.id];

    // Notify others to remove this cursor
    socket.broadcast.emit('cursor_disconnect', {
      id: socket.id
    });

    ipConnectionsCursor[ip] = Math.max((ipConnectionsCursor[ip] || 1) - 1, 0);
    if (ipConnectionsCursor[ip] === 0) delete ipConnectionsCursor[ip];
  });

  socket.on('error', (err) => {
    console.error('WebSocket error (cursor sync):', err);
  });
});

// ###########################
//           START
// ###########################

// Start the server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
server_cursor.listen(port_cursor, () => {
  console.log(`ServerCursor running on http://localhost:${port}`);
});
