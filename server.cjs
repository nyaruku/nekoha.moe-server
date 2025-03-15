const mysql = require('mysql2');
const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
require('dotenv').config({ path: 'secret.env' });

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

  if (!allowedChannels.includes(channel) && !(channel == "all")) {
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


// Function to format each row with fixed column widths
const formatRow = (timestamp, user_id, username, message) => {
  return `${timestamp.padEnd(22)} ${user_id.toString().padEnd(10)} ${username.padEnd(16)} ${message}`;
};

// API to export a single table as CSV
app.get('/api/log/download', (req, res) => {
  let channel = req.query.channel ? req.query.channel : 'osu'; // Default to 'osu'

  if (!allowedChannels.includes(channel)) {
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
