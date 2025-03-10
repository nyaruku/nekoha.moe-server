// ###########################
//       DISCORD BOT
// ###########################
const mysql = require('mysql2');
const { Client, GatewayIntentBits } = require('discord.js');

// Import Secrets
require('dotenv').config({ path: 'secret.env' });

// Discord Bot Logic
const discordclient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
  });
  
  discordclient.once('ready', () => {
    console.log(`Logged in as ${discordclient.user.tag}!`);
  });
  
  discordclient.on('messageCreate', async (message) => {
    try {
      // Ignore bot messages
      if (message.author.bot) return;
  
      // Handle specific channel commands
      if (message.author.id == 'your_owner_id_here') {
        // Handle other channels similarly...
      }
    } catch (error) {
      console.error("An error occurred:", error);
    }
  });
  
  // Login to Discord
  discordclient.login(process.env.DISCORD_BOT_TOKEN);