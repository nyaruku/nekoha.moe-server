// ###########################
//       DISCORD BOT
// ###########################
const mysql = require('mysql2');
const { Client, GatewayIntentBits } = require('discord.js');
const { io } = require('socket.io-client');
require('dotenv').config({ path: 'secret.env' });
const crypto = require('node:crypto');
// CRYPTO START
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
// CRYPTO END

// ---- MySQL setup ----
const db = mysql.createPool({
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

// ---- Discord setup ----
const discordclient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function sanitizeDiscordMentions(text) {
  return text
    .replace(/@everyone/g, '@\u200Beveryone')  // prevent @everyone
    .replace(/@here/g, '@\u200Bhere')          // prevent @here
    .replace(/<@!?(\d+)>/g, '<@\u200B$1>')     // prevent user mentions
    .replace(/<@&(\d+)>/g, '<@&\u200B$1>')     // prevent role mentions
    .replace(/<#(\d+)>/g, '<#\u200B$1>');      // prevent channel mentions
}


const TARGET_CHANNEL_ID = '1355904992489242734'; // Replace with your Discord channel ID

discordclient.once('ready', () => {
  console.log(`Logged in as ${discordclient.user.tag}!`);
});

// ---- When message sent in Discord -> send to DB and WebSocket ----
discordclient.on('messageCreate', async (message) => {

  if(message.author.bot) return;

  if (message.channel.id === TARGET_CHANNEL_ID){
    const timestamp = Date.now();
    const username = message.author.username;
    const content = message.content.slice(0, 2000);
    const color = '#5865F2'; // Discord blurple
  
    const query = `
      INSERT INTO chat (timestamp, username, message, discord, color)
      VALUES (?, ?, ?, ?, ?)
    `;
    const values = [timestamp, username, content, 1, color];
  
    db.query(query, values, (err, result) => {
      if (err) return console.error('DB insert error:', err);
  
      const newMessage = {
        id: result.insertId,
        timestamp,
        username,
        message: content,
        discord: 1,
        color,
      };
  
      // Emit message to website clients
      socket.emit('new_message', newMessage);
    });
  }
});

// ---- Socket.IO connection to your backend ----
const socket = io('http://localhost:5000/web-chat', {
  path: '/api/live/',
  transports: ['websocket'],
  reconnection: true,
  auth: {
    token: process.env.BOT_SOCKET_SECRET,
  },
});

socket.on('connect', () => {
  console.log('Connected to website WebSocket');
});

socket.on('new_message', (message) => {
  // Only forward messages not from Discord
  if (message.discord) return;

  const channel = discordclient.channels.cache.get(TARGET_CHANNEL_ID);
  if (channel) {
    channel.send(`[${message.username || 'anonymous'}] ${sanitizeDiscordMentions(message.message)}`);
  }
});

socket.on('disconnect', () => {
  console.log('Disconnected from website WebSocket');
});

socket.on('connect_error', (err) => {
  console.error('Socket connect error:', err.message);
});

// ---- Start the bot ----
discordclient.login(process.env.DISCORD_BOT_TOKEN);
