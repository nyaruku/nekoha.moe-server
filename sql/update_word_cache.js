import mysql from 'mysql2';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/admin/nekoha.moe/server/sql/secret.env' });
const DB_USER = process.env.DB_USER;
const DB_PW = process.env.DB_PW;
const DB_NAME_LOGGER = process.env.DB_NAME_LOGGER;
const DB_HOST = process.env.DB_HOST;

const channels = [
  'osu', 'german', 'portuguese', 'spanish', 'mapping', 'announce', 'osumania', 'help', 'lobby',
  'taiko', 'lazer', 'indonesian', 'french', 'ctb', 'dutch', 'chinese', 'english', 'arabic',
  'russian', 'cantonese', 'filipino', 'japanese', 'vietnamese', 'greek', 'modreqs', 'turkish',
  'korean', 'videogames', 'hungarian', 'finnish', 'thai', 'latvian', 'italian', 'ukrainian',
  'malaysian', 'polish', 'estonian', 'romanian', 'bulgarian', 'czechoslovak', 'balkan', 'uzbek',
  'taiwanese', 'hebrew', 'skandinavian', 'allm'
];

const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PW,
  database: DB_NAME_LOGGER,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

function normalizeWord(w) {
  return w.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '');
}

function parseAndCount(text, counts) {
  let remainder = text;
  const bracketRegex = /\[([^\[\]]*)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = bracketRegex.exec(remainder)) !== null) {
    const pre = remainder.slice(lastIndex, match.index);
    pre.split(/\s+/).forEach(w => {
      const nw = normalizeWord(w);
      if (nw.length > 1) counts[nw] = (counts[nw] || 0) + 1;
    });

    const bracketContent = match[1].trim();
    const parts = bracketContent.split(/\s+/);
    const maybeUrl = parts[0];

    if (/^https?:\/\//i.test(maybeUrl)) {
      counts[maybeUrl] = (counts[maybeUrl] || 0) + 1;

      const descWords = parts.slice(1);
      for (const word of descWords) {
        const nw = normalizeWord(word);
        if (nw.length > 1) counts[nw] = (counts[nw] || 0) + 1;
      }
    } else {
      const nw = normalizeWord(`[${bracketContent}]`);
      counts[nw] = (counts[nw] || 0) + 1;
    }

    lastIndex = bracketRegex.lastIndex;
  }

  const post = remainder.slice(lastIndex);
  post.split(/\s+/).forEach(w => {
    const nw = normalizeWord(w);
    if (nw.length > 1) counts[nw] = (counts[nw] || 0) + 1;
  });
}

async function processChannel(channel) {
  console.log(`Processing channel: ${channel}`);
  return new Promise((resolve, reject) => {
    const counts = {};
    const sql = `SELECT message FROM \`${channel}\` WHERE user_id <> 3`;

    const queryStream = pool.query(sql).stream();

    let messageCount = 0;

    queryStream.on('data', row => {
      messageCount++;
      let message = row.message;

      // Strip IRC CTCP commands wrapped in \x01COMMAND text\x01
      const ctcpRegex = /^\x01([A-Z]+) (.*)\x01$/i;
      const ctcpMatch = message.match(ctcpRegex);
      if (ctcpMatch) {
        const command = ctcpMatch[1].toUpperCase();

        if (command === 'ACTION') {
          return; // skip all /me messages (CTCP ACTION)
        }

        message = ctcpMatch[2]; // for other CTCP commands (optional)
      }

      parseAndCount(message, counts);
    });

    queryStream.on('error', err => {
      console.error(`Error processing channel ${channel}:`, err);
      reject(err);
    });

    queryStream.on('end', () => {
      console.log(`Processed ${messageCount} messages from ${channel}`);

      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)
        .map(([word, count]) => `${count}:${word}`);

      // Prepare insertion into word_frequency_cache table
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const topWordsString = sorted.join(' ');

      const insertSql = `
        INSERT INTO word_frequency_cache (channel, cached_at, top_words)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE top_words = VALUES(top_words)
      `;

      pool.query(insertSql, [channel, today, topWordsString], (err) => {
        if (err) {
          console.error(`Failed to insert cache for channel ${channel}:`, err);
          reject(err);
        } else {
          console.log(`Cached top words for ${channel} on ${today}`);
          resolve();
        }
      });
    });
  });
}

async function main() {
  console.log(`Connecting to DB: ${DB_NAME_LOGGER} at host ${DB_HOST}`);

  for (const ch of channels) {
    await processChannel(ch);
  }
  pool.end();
  console.log('All channels processed.');
}

main().catch(err => {
  console.error('Fatal error:', err);
});
