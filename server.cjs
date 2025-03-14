const mysql = require('mysql2');
const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Import Secrets
require('dotenv').config({ path: 'secret.env' });

// ###########################
//     DATABASE CONNECTION
// ###########################
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
  maxIdle: 1000, // max idle connections, the default value is the same as `connectionLimit`
  idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
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
  connection.release(); // Always release the connection back to the pool
});

// ###########################
//        WEB SOCKECT
// ###########################

// SETUP EXPRESS SERVER AND WEBSOCKETS
const app = express();
const port = 5000;
const server = http.createServer(app);
const io = require('socket.io')(server, {
  path: '/api/live/'
});

// CORS middleware for cross-origin requests
app.use(cors());
 
//////////////////////
// >> /api/live/osu //
//////////////////////

// Connection Var
let activeConnections = 0;
const osuNamespace = io.of("/osu");

// Connection Listener
osuNamespace.on("connection", (socket) => {
  activeConnections++; // Increase count when a client connects
  // console.log(`Client connected. Active connections: ${activeConnections}`);
  osuNamespace.emit("update-connection-count", activeConnections); // Send update to all clients

  // Disconnect
  socket.on("disconnect", () => {
    activeConnections--; // Decrease count when a client disconnects
    // console.log(`Client disconnected. Active connections: ${activeConnections}`);
    osuNamespace.emit("update-connection-count", activeConnections); // Send update to all clients
  });
});

// WebSocket helper function to send updates to clients
const notifyOsuClients = (newEntry) => {
  osuNamespace.emit("new-entry", newEntry);
};

///////////////////////
// >> /api/live/chat //
///////////////////////
const chatNamespace = io.of("/chat");

let activeChatUsers = 0;

chatNamespace.on("connection", (socket) => {
  activeChatUsers++;
  // console.log(`Chat client connected. Active users: ${activeChatUsers}`);
  chatNamespace.emit("update-chat-users", activeChatUsers);

  socket.on("disconnect", () => {
    activeChatUsers--;
    // console.log(`Chat client disconnected. Active users: ${activeChatUsers}`);
    chatNamespace.emit("update-chat-users", activeChatUsers);
  });
});

// Function to send new messages via WebSocket
const notifyChatClients = (newMessage) => {
  chatNamespace.emit("new-chat-message", newMessage);
};

// ###########################
//       API Endpoints
// ###########################

app.get('/api/log', (req, res) => {

  // Sanitize channel input by allowing only specific values
  const allowedChannels = [
    'announce', 'arabic', 'balkan', 'bulgarian', 'cantonese', 'chinese', 'ctb', 'czechoslovak',
    'dutch', 'english', 'estonian', 'filipino', 'finnish', 'french', 'german', 'greek', 'hebrew',
    'help', 'hungarian', 'indonesian', 'italian', 'japanese', 'korean', 'latvian', 'lazer',
    'lobby', 'malaysian', 'mapping', 'modreqs', 'osu', 'osumania', 'polish', 'portuguese',
    'romanian', 'russian', 'skandinavian', 'spanish', 'taiko', 'taiwanese', 'thai', 'turkish',
    'ukrainian', 'uzbek', 'videogames', 'vietnamese', 'all'
  ];
  
  let channel = req.query.channel ? req.query.channel : 'osu'; // Default to 'osu'

  if (!allowedChannels.includes(channel)) {
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

  if (channel == "all") {
    query = allowedChannels
      .filter(ch => ch !== "all") // Exclude "all" from actual table names
      .map(ch => `SELECT * FROM ${ch} ${whereClause}`)
      .join(" UNION ALL ");
  } else {
    query = `SELECT * FROM ${channel} ${whereClause}`;
  }


  if (channel == "all") {
    if (sort === "asc" || sort === "desc") {
      query += ` ORDER BY timestamp ${sort}`;
    } else {
      query += " ORDER BY timestamp ASC";
    }
  } else {
    if (sort === "asc" || sort === "desc") {
      query += ` ORDER BY id ${sort}`;
    } else {
      query += " ORDER BY id ASC";
    }
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

const { exec } = require('child_process');
app.get('/api/log/stats', (req, res) => {
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

    // Calculate the total size of the database from MySQL metadata
    const totalSize = results.reduce((sum, table) => sum + parseFloat(table.sizeMB), 0);
    const totalRowCount = results.reduce((sum, table) => sum + parseInt(table.rowCount, 10), 0);

    exec("echo '" + process.env.SUDO_PW + "' | sudo -S du -sb /var/lib/mysql/osu_logger", (err, stdout) => {
      if (err) {
        console.error("Error executing du command:", err);
        return res.status(500).json({ error: "Failed to retrieve actual disk usage" });
      }

      // Extract size from the 'du' output
      const actualSizeBytes = parseInt(stdout.split("\t")[0], 10);
      const actualSizeMB = actualSizeBytes // Convert to MB with 2 decimals

      res.json({
        totalDatabaseSizeBytes: totalSize,
        actualDiskAllocBytes: actualSizeMB,
        totalRowCount: totalRowCount,
        tables: results
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


// Fetch Chat Messages
app.get('/api/chat', (req, res) => {
  db_nekoha.query("SELECT * FROM chat ORDER BY id DESC LIMIT 50", (err, results) => {
    if (err) {
      console.error('Error fetching messages:', err);
      return res.status(500).send('Error fetching messages');
    }
    res.json(results);
  });
});

// Store New Chat Message
app.post('/api/chat', (req, res) => {
  const unixTimeInSeconds = Math.floor(Date.now());
  const { username, message } = req.body;
  if (!username || !message) return res.status(400).send("Invalid data");

  const query = "INSERT INTO chat (timestamp, username, message) VALUES (?, ?)";
  db_nekoha.query(query, [unixTimeInSeconds, username, message], (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send("Database error");
    }

    const newMessage = { id: result.insertId, username, message };
    notifyChatClients(newMessage); // Send to WebSocket clients

    res.status(201).json(newMessage);
  });
});

// ###########################
//           START
// ###########################

// Start the server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
