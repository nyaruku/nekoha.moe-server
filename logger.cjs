
// ###########################
//         IRC LOGGER
// ###########################

const mysql = require('mysql2');
const express = require('express');
const http = require('http');
const fs = require('fs');
const { WebhookClient } = require('discord.js');

// Import Secrets
require('dotenv').config({ path: 'secret.env' });

// ==========================
// Load webhooks.json
// ==========================
const webhookMap = {};
const webhookData = JSON.parse(fs.readFileSync('webhook.json', 'utf8'));

for (const entry of webhookData) {
  webhookMap[`#${entry.channelName}`] = new WebhookClient({ url: entry.webhookUrl });
}
const globalWebhook = webhookMap['#all-channels'];

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

/* not used
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
*/
const bot_info_webhook = new WebhookClient({ url: process.env.WEBHOOK_INFO });

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
  if (now - lastMessageTimestamp > 120000) { // no message for 120 seconds
    console.warn("No IRC messages received for 120 seconds, reconnecting...");
    client.disconnect().then(() => {
      client.connect().catch(err => {
        console.error("Reconnect failed:", err);
      });
    });
  }
}, 30000);

async function safeSend(webhook, payload) {
  for (let i = 0; i < 5; i++) {
    try {
      await webhook.send(payload);
      return;
    } catch (err) {
      if (err.status === 429 && err.data?.retry_after) {
        const wait = Math.ceil(err.data.retry_after * 1000);
        console.warn(`Rate limited. Retrying in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      } else throw err;
    }
  }
}

// Bancho Client Logic - Listening to messages
(async () => {
  try {
    console.log("IRC Logger Launched");
    await safeSend(bot_info_webhook, { content: `IRC Logger Launched` });
    await client.connect();
    console.log("Connected to Bancho!");
    await safeSend(bot_info_webhook, { content: `Connected to Bancho!` });

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
      await safeSend(bot_info_webhook, { content: `Joined ${channelName} channel!` });
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

        //recordInsert(true);
        db.execute(
          `INSERT INTO \`${tableName}\` (timestamp, user_id, username, message) VALUES (?, ?, ?, ?)`,
          [unixTimeInSeconds, userId, username, originalMessage],
          (err) => {
            if (err) {
              //recordInsert(false);
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
        db.execute(
          `INSERT INTO \`allm\` (timestamp, user_id, username, message, channel) VALUES (?, ?, ?, ?, ?)`,
          [unixTimeInSeconds, userId, username, originalMessage, tableName],
          (err) => {
            if (err) {
              console.error("Database error:", err);
              return;
            }
        });
        const newUsername = `${username} (${userId})`;
        console.log(newUsername);
        const safeContent = originalMessage.replace(/@/g, " ");
        // Send to matching Discord channel
        const channelWebhook = webhookMap[channelName];
        if (channelWebhook) {
          try {
            await safeSend(channelWebhook, { username: newUsername, avatarURL: avatarUrl, content: safeContent });
          } catch (err) {
            console.error(`Webhook send failed for ${channelName}:`, err.message);
          }
        }
        // Send the same message to #all-channels webhook
        if (globalWebhook) {
          try {
            await safeSend(globalWebhook, { username: newUsername, avatarURL: avatarUrl, content: safeContent });
          } catch (err) {
            console.error(`Global webhook send failed:`, err.message);
          }
        }
      });
    }

    client.on("disconnect", () => {
      safeSend(bot_info_webhook, { content: `Disconnected from Bancho, attempting to reconnect...` });
      console.log("Disconnected from Bancho, attempting to reconnect...");
      client.connect().catch(err => console.error("Reconnection failed:", err));
    });
  } catch (error) {
    safeSend(bot_info_webhook, { content: `An error occurred` });
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

