
// ###########################
//         IRC LOGGER
// ###########################

const mysql = require('mysql2');

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

const username = process.env.OSU_USERNAME;
const password = process.env.OSU_IRC_PW;
const apiKey = process.env.OSU_API_KEY;
const client = new BanchoClient({
  username,
  password,
  apiKey,
});

// Bancho Client Logic - Listening to messages
(async () => {
  try {
    console.log("IRC Logger Launched");
    await client.connect();
    console.log("Connected to Bancho!");

    const channelsToJoin = [
      "#osu", "#german", "#announce", "#arabic", "#balkan", "#bulgarian", "#cantonese", "#chinese", "#ctb", "#czechoslovak",
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
        const unixTimeInSeconds = Math.floor(Date.now());
        const originalMessage = message.message;
        message.message = message.message.replace(/@/g, " "); // Clean message
        await message.user.fetchFromAPI();
        const avatarUrl = `https://a.ppy.sh/${message.user.id}`;

        // Store message in respective MySQL table
        const tableName = channelName.slice(1); // Remove '#' to get table name
        db.execute(
          `INSERT INTO ${tableName} (timestamp, user_id, username, message) VALUES (?, ?, ?, ?)`,
          [unixTimeInSeconds, message.user.id, message.user.ircUsername, originalMessage],
          (err) => {
            if (err) {
              console.error("Database error:", err);
            }
          }
        );
      });
    }

    client.on("disconnect", () => {
      console.log("Disconnected from Bancho!");
    });
  } catch (error) {
    console.error("An error occurred:", error);
  }
})();