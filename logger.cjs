
// ###########################
//         IRC LOGGER
// ###########################

// global 
let insertCount = 0;
let insertError = 0;
let insertHistory = []; // Store timestamps of inserts

function recordInsert(success = true) {
  insertHistory.push(Date.now());

  // Keep only the last 24 hours of data
  const oneDayAgo = Date.now() - 86400000;
  insertHistory = insertHistory.filter(ts => ts > oneDayAgo);
}


const mysql = require('mysql2');
const express = require('express');
const http = require('http');

// Import Secrets
require('dotenv').config({ path: 'secret.env' });

const { BanchoClient, OutgoingBanchoMessage, BanchoChannel } = require("bancho.js");

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

const db_info = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PW,
  database: process.env.DB_NAME_LOGGER_INFO,

  waitForConnections: true,
  connectionLimit: 1000,
  maxIdle: 1000, // max idle connections, the default value is the same as `connectionLimit`
  idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});


const username = process.env.OSU_USERNAME;
const password = process.env.OSU_IRC_PW;
const apiKey = process.env.OSU_API_KEY;
const client = new BanchoClient({
  username,
  password,
  apiKey,
});

let lastMessageTimestamp = Date.now();

function resetWatchdog() {
  lastMessageTimestamp = Date.now();
}

setInterval(() => {
  const now = Date.now();
  if (now - lastMessageTimestamp > 60000) { // no message for 60 seconds
    console.warn("No IRC messages received for 60 seconds, reconnecting...");
    client.disconnect().then(() => {
      client.connect().catch(err => {
        console.error("Reconnect failed:", err);
      });
    });
  }
}, 30000);

// Bancho Client Logic - Listening to messages
(async () => {
  try {
    console.log("IRC Logger Launched");
    await client.connect();
    console.log("Connected to Bancho!");

    // #balkan removed
    const channelsToJoin = [
      "#osu", "#german", "#announce", "#arabic", "#bulgarian", "#cantonese", "#chinese", "#ctb", "#czechoslovak",
      "#dutch", "#english", "#estonian", "#filipino", "#finnish", "#french", "#greek", "#hebrew",
      "#help", "#hungarian", "#indonesian", "#italian", "#japanese", "#korean", "#latvian", "#lazer",
      "#lobby", "#malaysian", "#mapping", "#modreqs", "#osumania", "#polish", "#portuguese",
      "#romanian", "#russian", "#skandinavian", "#spanish", "#taiko", "#taiwanese", "#thai", "#turkish",
      "#ukrainian", "#uzbek", "#videogames", "#vietnamese"
    ];

    const channels = {};

    for (const channelName of channelsToJoin) {
      const channel = client.getChannel(channelName);
      await channel.join();
      channels[channelName] = channel;
      console.log(`Joined ${channelName} channel!`);

      channel.on("message", async (message) => {
        resetWatchdog();
        const unixTimeInSeconds = Math.floor(Date.now());
        const originalMessage = message.message;
        await message.user.fetchFromAPI();
        const avatarUrl = `https://a.ppy.sh/${message.user.id}`;

        const tableName = channelName.slice(1); // Remove '#' to get table name
        const userId = message.user.id;
        const username = message.user.ircUsername;

        recordInsert(true);
        db.execute(
          `INSERT INTO \`${tableName}\` (timestamp, user_id, username, message) VALUES (?, ?, ?, ?)`,
          [unixTimeInSeconds, userId, username, originalMessage],
          (err) => {
            if (err) {
              recordInsert(false);
              console.error("Database error:", err);
              return;
            }

            // Get the most recent ID for this user in this channel
            db.execute(
              `SELECT MAX(id) AS max_id FROM \`${tableName}\` WHERE user_id = ?`,
              [userId],
              (err, [row]) => {
                if (err || !row || row.max_id == null) {
                  console.error("Failed to get max_id:", err || "No row");
                  return;
                }

                const lastSeenId = row.max_id;

                // Update the global latest_usernames cache
                db.execute(
                  `
                  INSERT INTO latest_usernames (user_id, username, last_seen_channel, timestamp)
                  VALUES (?, ?, ?, ?)
                  ON DUPLICATE KEY UPDATE
                    username = IF(VALUES(timestamp) > timestamp, VALUES(username), username),
                    last_seen_channel = IF(VALUES(timestamp) > timestamp, VALUES(last_seen_channel), last_seen_channel),
                    timestamp = GREATEST(VALUES(timestamp), timestamp)
                  `,
                  [userId, username, tableName, unixTimeInSeconds],
                  (err) => {
                    if (err) {
                      console.error("Failed to update latest_usernames:", err);
                    }
                  }
                );
              }
            );
          }
        );

        db_info.execute(
          `INSERT INTO \`all\` (timestamp, user_id, username, message, channel) VALUES (?, ?, ?, ?, ?)`,
          [unixTimeInSeconds, userId, username, originalMessage, tableName],
          (err) => {
            if (err) {
              console.error("Database error:", err);
              return;
            }
        });

      });
    }

    client.on("disconnect", () => {
      console.log("Disconnected from Bancho, attempting to reconnect...");
      client.connect().catch(err => console.error("Reconnection failed:", err));
    });
  } catch (error) {
    console.error("An error occurred:", error);
  }
})();

// ###########################
//     INSERTS PER MINUTE
// ###########################

const app = express();
const port = 5001;
const server = http.createServer(app);

// Start the server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

setInterval(() => {
  insertError = 0;
}, 60000);

app.get("/api2/insert", (req, res) => {
  const oneHourAgo = Date.now() - 86400000;
  let dataPoints = [];

  // Group inserts into per-minute intervals
  for (let i = 0; i < 1440; i++) {
    const startTime = oneHourAgo + i * 60000;
    const count = insertHistory.filter(ts => ts >= startTime && ts < startTime + 60000).length;

    // Append as time series data
    dataPoints.push([startTime, count]);
  }

  res.json({
    results: [
      {
        statement_id: 0,
        series: [
          {
            name: "inserts_per_minute",
            columns: ["time", "value"],
            values: dataPoints
          }
        ]
      }
    ]
  });
});