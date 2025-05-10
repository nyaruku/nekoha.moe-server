const mysql = require('mysql2');
const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
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
app.get('/api/log/download', async (req, res) => {
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

// page counter
app.get('/api/count', async(req, res) => {

});


// ###########################
//           YTDL
// ###########################

function bytesToMebibytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + "MiB";
}

app.get("/api/ytdlp/info", async(req, res) => {
  let url = req.query.url ? req.query.url : '';

  try {
    const cookiesPath = path.join(os.homedir(), 'yt-cookies'); // Resolves ~/yt-cookies correctly
    const info = await ytDlp.execPromise([
        url,
        "--cookies", cookiesPath,
        "--dump-json" // Fetch metadata only, do not download
    ]);

    const videoInfo = JSON.parse(info);

    // Filter out storyboard formats and extract relevant video formats
    const videoFormats = videoInfo.formats
      .filter(f => !f.format_note.includes("storyboard") && f.acodec === "none")
      .map(f => [
        f.format_id,
        `${f.resolution}@${f.fps}FPS (${f.ext}) (${bytesToMebibytes(f.filesize_approx)} MiB)`
      ]);

    // Filter out storyboard formats and extract relevant audio formats
    const audioFormats = videoInfo.formats
      .filter(f => !f.format_note.includes("storyboard") && f.vcodec === "none")
      .map(f => [
        f.format_id,
        `${f.acodec} (${f.ext}) (${bytesToMebibytes(f.filesize_approx)} MiB)`
      ]);

    res.json({
      videoInfo: {
        id: videoInfo.id,
        title: videoInfo.title,
        duration: videoInfo.duration,
        uploader: videoInfo.uploader,
        thumbnail: videoInfo.thumbnail,
        webpage_url: videoInfo.webpage_url
      },
      videoFormats: videoFormats,
      audioFormats: audioFormats
    });
  } catch (error) {
      res.status(500).send("Error fetching video info: " + error);
      return;
  }
});

app.get("/api/ytdlp/download", async (req, res) => {
  let url = req.query.url || "";
  let video_format_id = parseInt(req.query.video, 10);
  let audio_format_id = parseInt(req.query.audio, 10);

  if (!url) {
    return res.status(400).json({ error: "Missing video URL" });
  }

  try {
    const outputDir = path.join(os.tmpdir(), "ytdlp_downloads");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const cookiesPath = path.join(os.homedir(), "yt-cookies");
    let metadataCommand = `yt-dlp --cookies "${cookiesPath}" --dump-json "${url}"`;
    console.log("Fetching metadata with:", metadataCommand);

    exec(metadataCommand, (metaError, metaStdout, metaStderr) => {
      if (metaError) {
        console.error("Metadata fetch error:", metaStderr);
        return res.status(500).json({ error: "Failed to fetch metadata", details: metaStderr });
      }

      let videoInfo;
      try {
        videoInfo = JSON.parse(metaStdout);
      } catch (parseError) {
        console.error("Error parsing metadata:", parseError);
        return res.status(500).json({ error: "Error parsing metadata" });
      }
      
      const sanitizedTitle = videoInfo.title.replace(/[^a-zA-Z0-9-_\.]/g, "_");
      const outputFilePath = path.join(outputDir, `${sanitizedTitle}.%(ext)s`);
      let command = `yt-dlp -o "${outputFilePath}" --cookies "${cookiesPath}"`;

      if (video_format_id === 0 && audio_format_id === 0) {
        command += " -f bestvideo+bestaudio --merge-output-format mkv";
      } else if (video_format_id && audio_format_id) {
        command += ` -f ${video_format_id}+${audio_format_id}`;
      } else if (video_format_id) {
        command += ` -f ${video_format_id}`;
      } else if (audio_format_id) {
        command += ` -f ${audio_format_id}`;
      }

      command += ` ${url}`;
      console.log("Executing download command:", command);

      exec(command, (error, stdout, stderr) => {
        console.log("yt-dlp output:", stdout);
        console.log("yt-dlp error:", stderr);

        if (error) {
          return res.status(500).json({ error: "Download failed", details: stderr });
        }

        const downloadedFile = fs.readdirSync(outputDir).find(file => file.startsWith(sanitizedTitle));
        if (!downloadedFile) {
          console.error("File not found after download");
          return res.status(500).json({ error: "File not found after download" });
        }

        const filePath = path.join(outputDir, downloadedFile);
        console.log("Serving file:", filePath);
        res.download(filePath, downloadedFile, (err) => {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          } else {
              console.log(`File not found: ${filePath}`);
          }
          if (err) {
            console.error("File download error:", err);
            res.status(500).json({ error: "File download error" });
          }
        });
      });
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: "Server error", details: error.message });
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
  const ipaddr = req.ip;
  const unixTimeMs = Date.now();

  let { username, message, color, discord } = req.body;

  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).send('Message is required');
  }

  message = message.trim().slice(0, 2000);
  message = leoProfanity.clean(message);
  username = typeof username === 'string' ? username.trim().slice(0, 20) : null;
  color = typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color)
    ? color
    : '#FFFFFF';
  discord = discord === 1 ? 1 : 0; // Only allow 1 or 0

  if (username === '') {
    username = null;
  }

  const query = `
    INSERT INTO chat (timestamp, username, message, color, discord, ip)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const values = [unixTimeMs, username, message, color, discord, ipaddr];

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

    notifyChatClients(newMessage);

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

    socket.broadcast.emit('new_message', message);
  });
  // You can also listen for custom events sent from the client if needed
  // Example: socket.on('message', (message) => { ... });

});

// Function to broadcast to all clients in the chat namespace
function notifyChatClients(messageObject) {
  // Emit the 'new_message' event to all connected clients in the chat namespace
  chatNamespace.emit('new_message', messageObject);  // This will broadcast to all clients connected to /web-chat
}

setInterval(() => {
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
//           START
// ###########################

// Start the server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
