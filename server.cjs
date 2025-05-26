const mysql = require('mysql2');
const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const crypto = require('node:crypto');
const path = require('path');
const { format } = require('date-fns');
const os = require('os');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ytDlp = new YTDlpWrap();
require('dotenv').config({ path: 'secret.env' });
const { exec } = require('child_process');
const leoProfanity = require('leo-profanity');
const rateLimit = require('express-rate-limit');
leoProfanity.loadDictionary(); // optional, default is English

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
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PW,
  database: process.env.DB_NAME_LOGGER,

  waitForConnections: true,
  connectionLimit: 1000,
  maxIdle: 1000, // max idle connections, the default value is the same as `connectionLimit`
  idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
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

// MySQL database connection test
db.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    return;
  }
  console.log('Connected to MySQL (Connection Pool)');
  connection.release();
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

  let userId = parseInt(req.query.user_id, 10);
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

  if (!isNaN(userId) && userId > 0) {
    conditions.push("user_id = ?");
    params.push(userId);
  }

  if (username) {
    conditions.push("username = ?");
    params.push(username);
  }

  if (messageFilter) {
    conditions.push("message LIKE ?");
    params.push(`%${messageFilter}%`);
  }

  if (!isNaN(timeStart)) {
    conditions.push("timestamp >= ?");
    params.push(timeStart);
  }

  if (!isNaN(timeEnd)) {
    conditions.push("timestamp <= ?");
    params.push(timeEnd);
  }

  let whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

  query = `SELECT * FROM ${channel} ${whereClause}`;

  if (sort === "asc" || sort === "desc") {
    query += ` ORDER BY id ${sort}`;
  } else {
    query += " ORDER BY id ASC";
  }

  if (!isNaN(limit) && limit > 0) {
    query += ` LIMIT ${limit}`;
  }

  if (!isNaN(offset) && offset > 0) {
    query += ` OFFSET ${offset}`;
  }

  // console.log("Executing query:", query);
  // console.log("With parameters:", params);

  db.execute(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching entries:", err);
      res.status(500).send("Error fetching chat");
      return;
    }
    res.json(results);
  });
});

app.get('/api/log/stats', async (req, res) => {

  const [totalRowsPromise, uniqueUsersPromise] = [
    db.promise().query("SELECT COUNT(*) AS total FROM `allm`"),
    db.promise().query("SELECT COUNT(*) AS unique_users FROM latest_usernames"),
  ];

  const [[totalRows], [uniqueUsers]] = await Promise.all([totalRowsPromise, uniqueUsersPromise]).catch(err => {
    console.error(err);
    res.status(500).json({ error: err.message });
    return [ [null], [null] ]; // keep destructuring safe
  });

  if (!totalRows || !uniqueUsers) return;

  const totalRowCount = totalRows[0].total;
  const uniqueUsersCount = uniqueUsers[0].unique_users;

  const query = `
    SELECT table_name AS tableName,
           (data_length + index_length) AS sizeMB,
           table_rows AS rowCount
    FROM information_schema.TABLES
    WHERE table_schema = 'osu_logger'
    ORDER BY table_rows DESC;
  `;

  db.query(query, (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Exclude 'latest_usernames' table
    const filteredResults = results.filter(table => table.tableName !== 'latest_usernames');
    const totalSize = filteredResults.reduce((sum, table) => sum + parseFloat(table.sizeMB), 0);

    exec("echo '" + process.env.SUDO_PW + "' | sudo -S du -sb /var/lib/mysql/osu_logger", (err, stdout) => {
      if (err) {
        console.error("Error executing du command:", err);
        return res.status(500).json({ error: "Failed to retrieve actual disk usage" });
      }

      const actualSizeBytes = parseInt(stdout.split("\t")[0], 10);

      res.json({
        totalDatabaseSizeBytes: totalSize,
        actualDiskAllocBytes: actualSizeBytes,
        totalRowCount: totalRowCount,
        uniqueUsers: uniqueUsersCount,
        tables: filteredResults // use `filteredResults` here instead if you want to exclude it from the response
      });
    });
  });
});

app.get('/api/log/export', (req, res) => {
  const fileName = `chat_log_mysqldump_${Date.now()}.sql`;
  const filePath = path.join(__dirname, 'backups', fileName);

  // Ensure the backups directory exists
  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath));
  }

  // Create MySQL dump command
  const dumpCommand = `mysqldump --user=${process.env.DB_USER} --password=${process.env.DB_PW} --host=${process.env.DB_HOST} ${process.env.DB_NAME_LOGGER} > ${filePath}`;

  // Execute the command to export the database
  exec(dumpCommand, (error, stdout, stderr) => {
    if (error) {
      console.error('Error exporting database:', error);
      return res.status(500).json({ error: 'Failed to export database' });
    }
    // Send the backup file to the client
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        return res.status(500).json({ error: 'Failed to send database backup' });
      }

      // Optionally, delete the file after download
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Error deleting backup file:', unlinkErr);
        }
      });
    });
  });
});

// Function to format each row with fixed column widths
const formatRow = (timestamp, user_id, username, message) => {
  return `${timestamp.padEnd(22)} ${user_id.toString().padEnd(10)} ${username.padEnd(16)} ${message}`;
};

// API to export a single table as CSV
app.get('/api/log/download', async (req, res) => {
  let channel = req.query.channel ? req.query.channel : 'osu'; // Default to 'osu'

  if (!allowedChannels.includes(channel) && !(channel == "allm")) {
    return res.status(400).send('Invalid channel');
  }

  const fileName = `chat_log_${channel}_${Date.now()}.txt`;
  const filePath = path.join(__dirname, 'backups', fileName);

  // Ensure the backups directory exists
  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const writeStream = fs.createWriteStream(filePath);

  db.query(`SELECT timestamp, user_id, username, message FROM ${channel}`, (err, rows, fields) => {
    if (err) {
      console.error(`Error exporting table ${channel}:`, err);
      return res.status(500).json({ error: `Failed to export table: ${channel}` });
    }

    if (rows.length > 0) {
      writeStream.write(formatRow("timestamp", "user_id", "username", "message") + '\n');
    }

    rows.forEach(row => {
      writeStream.write(formatRow(
        formatTimestamp(row.timestamp),
        row.user_id,
        row.username,
        row.message
      ) + '\n');
    });

    writeStream.end();

    writeStream.on('finish', () => {
      res.download(filePath, fileName, (err) => {
        if (err) {
          console.error('Error sending file:', err);
          return res.status(500).json({ error: 'Failed to send TXT file' });
        }

        // Delete file after download
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error('Error deleting TXT file:', unlinkErr);
          }
        });
      });
    });

    writeStream.on('error', (err) => {
      console.error('Error writing TXT file:', err);
      return res.status(500).json({ error: 'Failed to write TXT file' });
    });
  });
});

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


app.get('/api/log/info', (req, res) => {
  const channel = req.query.channel;
  const rawStart = req.query.start;
  const rawEnd = req.query.end;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 15, 100); // max 100 per page

  if (!allowedChannels.includes(channel) && !(channel == "allm")) {
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

  if (timeStart !== null) {
    conditions.push('m.timestamp >= ?');
    params.push(timeStart);
  }
  if (timeEnd !== null) {
    conditions.push('m.timestamp <= ?');
    params.push(timeEnd);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(DISTINCT m.user_id) AS total
    FROM \`${channel}\` m
    ${whereClause}
  `;

const dataSql = `
  SELECT 
    t.user_id,
    u.username,
    t.message_count
  FROM (
    SELECT 
      m.user_id,
      COUNT(*) AS message_count
    FROM \`${channel}\` m
    ${whereClause}
    GROUP BY m.user_id
    ORDER BY message_count DESC
    LIMIT ${pageSize} OFFSET ${offset}
  ) AS t
  LEFT JOIN latest_usernames u ON t.user_id = u.user_id
  ORDER BY t.message_count DESC
`;

  const tableStatsSql = `
    SELECT 
      table_name AS table_name, 
      table_rows AS row_count, 
      ROUND((data_length + index_length) / 1024 / 1024, 2) AS allocated_mb
    FROM information_schema.tables 
    WHERE table_schema = 'osu_logger'
      AND table_name != 'latest_usernames'
  `;

  db.execute(countSql, params, (countErr, countResults) => {
    if (countErr) {
      console.error('Count query error:', countErr);
      return res.status(500).json({ error: 'Internal server error' });
    }

    const total = countResults[0].total;

    db.execute(dataSql, params, (err, results) => {
      if (err) {
        console.error('Data query error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      db.query(tableStatsSql, (tableErr, tableResults) => {
        if (tableErr) {
          console.error('Table stats error:', tableErr);
          return res.status(500).json({ error: 'Failed to retrieve table stats' });
        }
        res.json({
          items: results,
          total,
          tableStats: tableResults
        });
      });
    });
  });
});
// ###########################
//           YTDL
// ###########################

// removed

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

const io = require('socket.io')(server, {
  path: '/api/live/'
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

  const token = socket.handshake.auth?.token;
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


const io_cursor = require('socket.io')(server_cursor, {
  path: '/api/live/cursor-ws/'
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
