import mysql from 'mysql2';
import dotenv from 'dotenv';
dotenv.config();

const DB_USER = process.env.DB_USER;
const DB_PW = process.env.DB_PW;
const DB_NAME_LOGGER = process.env.DB_NAME_LOGGER;
const DB_HOST = process.env.DB_HOST || 'localhost';

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

    const bracketContent = match[1];
    const urlMatch = bracketContent.match(/^https?:\/\/[^\s]+/);

    if (urlMatch) {
      const url = urlMatch[0];
      counts[url] = (counts[url] || 0) + 1;

      const desc = bracketContent.slice(url.length).trim();
      desc.split(/\s+/).forEach(w => {
        const nw = normalizeWord(w);
        if (nw.length > 1) counts[nw] = (counts[nw] || 0) + 1;
      });
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

    queryStream.on('data', row => {
      const message = row.message;
      parseAndCount(message, counts);
    });

    queryStream.on('error', err => {
      console.error(`Error processing channel ${channel}:`, err);
      reject(err);
    });

    queryStream.on('end', () => {
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 150)
        .map(([word, count]) => `${count}:${word}`);

      console.log(`Top words for ${channel} (count:word):`);
      console.log(sorted.join(' '));
      console.log('---------------------------------------');
      resolve();
    });
  });
}

async function main() {
  for (const ch of channels) {
    await processChannel(ch);
  }
  pool.end();
  console.log('All channels processed.');
}

main().catch(err => {
  console.error('Fatal error:', err);
});
