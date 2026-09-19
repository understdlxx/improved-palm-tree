/**
 * improved-palm-tree v2.0
 * Fixed & cleaned Discord video stream selfbot
 * Original issues fixed:
 *  - ERR_MODULE_NOT_FOUND for libsodium-wrappers
 *  - Mixed CJS/ESM problems
 *  - Missing package.json & dependency declarations
 *  - Poor error handling
 *  - Potential lag from unhandled promises / interval
 *  - Fragile git push & DB handling
 */

'use strict';

const { Client } = require('discord.js-selfbot-v13');
const sqlite3 = require('sqlite3').verbose();
const { execSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ========== Config from environment ==========
const TOKEN = process.env.TOKEN;
const OWNER_ID = process.env.KAMBIZ_ID || process.env.OWNER_ID;

if (!TOKEN || !OWNER_ID) {
  console.error('[-] Missing required secrets: TOKEN and KAMBIZ_ID (or OWNER_ID)');
  process.exit(1);
}

// ========== Encryption (AES-256-CBC) ==========
const ENCRYPTION_KEY = crypto.createHash('sha256').update(TOKEN).digest();
const IV_LENGTH = 16;

function encryptData(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptData(text) {
  try {
    const parts = text.split(':');
    if (parts.length < 2) return null;
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

// ========== State ==========
const localState = {
  url: null,
  currentTime: 0,
  bookmarks: [],
  isPlaying: false,
  streamConnection: null,
};

let streamer = null;
let streamVideo = null;
let timeInterval = null;

// ========== Database ==========
const DB_PATH = path.join(__dirname, 'kambiz_memory.sqlite');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS encrypted_state (
      id TEXT PRIMARY KEY,
      secure_payload TEXT
    )
  `);
});

function loadDB() {
  return new Promise((resolve) => {
    db.get("SELECT secure_payload FROM encrypted_state WHERE id = 'main'", (err, row) => {
      if (err) {
        console.warn('[-] DB load warning:', err.message);
        return resolve();
      }
      if (row && row.secure_payload) {
        const decrypted = decryptData(row.secure_payload);
        if (decrypted) {
          try {
            const parsed = JSON.parse(decrypted);
            localState.url = parsed.url || null;
            localState.currentTime = Number(parsed.current_time) || 0;
            localState.bookmarks = Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [];
            console.log(`[+] Memory loaded. Time: ${formatTime(localState.currentTime)}`);
          } catch (e) {
            console.warn('[-] Failed to parse saved state');
          }
        }
      }
      resolve();
    });
  });
}

function saveDB() {
  return new Promise((resolve) => {
    const raw = JSON.stringify({
      url: localState.url,
      current_time: localState.currentTime,
      bookmarks: localState.bookmarks,
    });
    const encrypted = encryptData(raw);
    db.run(
      `INSERT OR REPLACE INTO encrypted_state (id, secure_payload) VALUES (?, ?)`,
      ['main', encrypted],
      (err) => {
        if (err) console.warn('[-] DB save warning:', err.message);
        resolve();
      }
    );
  });
}

function pushDBtoGitHub() {
  // Optional & best-effort. Do not crash the bot if git fails.
  try {
    if (!fs.existsSync(path.join(__dirname, '.git'))) {
      return;
    }
    execSync('git config user.name "Ghost Bot"', { stdio: 'ignore' });
    execSync('git config user.email "ghost@local"', { stdio: 'ignore' });
    execSync('git add kambiz_memory.sqlite', { stdio: 'ignore' });
    execSync('git commit -m "Auto-save encrypted state" || true', { stdio: 'ignore' });
    execSync('git push || true', { stdio: 'ignore' });
    console.log('[+] DB push attempted.');
  } catch {
    // silently ignore
  }
}

// ========== Helpers ==========
function formatTime(secs) {
  secs = Math.floor(Number(secs) || 0);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function startTimeTracker() {
  if (timeInterval) clearInterval(timeInterval);
  timeInterval = setInterval(async () => {
    if (localState.isPlaying) {
      localState.currentTime += 1;
      if (localState.currentTime % 20 === 0) {
        await saveDB().catch(() => {});
      }
    }
  }, 1000);
}

function stopTimeTracker() {
  if (timeInterval) {
    clearInterval(timeInterval);
    timeInterval = null;
  }
}

// ========== Streaming ==========
async function startStreaming(channel, startTime = 0) {
  if (!localState.url) {
    console.log('[-] No video URL set. Use !setvid <url>');
    return;
  }
  if (!streamer || !streamVideo) {
    console.error('[-] Stream engine not loaded');
    return;
  }

  try {
    await streamer.joinVoice(channel.guild.id, channel.id);
    const udp = await streamer.createStream();

    udp.mediaConnection.setSpeaking(true);
    udp.mediaConnection.setVideoStatus(true);
    localState.streamConnection = udp;

    const ffmpegArgs = [
      '-re',
      `-ss ${Math.max(0, startTime)}`,
      '-preset ultrafast',
      '-tune zerolatency',
      '-max_muxing_queue_size 1024',
      '-threads 2',
    ].join(' ');

    console.log(`[>>] Streaming from ${formatTime(startTime)}...`);
    streamVideo(localState.url, udp, ffmpegArgs, {
      width: 1280,
      height: 720,
      fps: 30,
      bitrateKbps: 2500,
    });

    localState.isPlaying = true;
    localState.currentTime = startTime;
    startTimeTracker();
  } catch (err) {
    console.error('[-] Stream start failed:', err.message || err);
    localState.isPlaying = false;
  }
}

async function stopStreaming() {
  try {
    if (localState.streamConnection) {
      try {
        localState.streamConnection.mediaConnection.setSpeaking(false);
        localState.streamConnection.mediaConnection.setVideoStatus(false);
      } catch {}
    }
    if (streamer) {
      try {
        streamer.leaveVoice();
      } catch {}
    }
  } finally {
    localState.streamConnection = null;
    localState.isPlaying = false;
    stopTimeTracker();
    await saveDB();
    pushDBtoGitHub();
    console.log(`[||] Stream stopped. Saved time: ${formatTime(localState.currentTime)}`);
  }
}

// ========== Discord Client ==========
const client = new Client({
  checkUpdate: false,
});

client.on('ready', async () => {
  console.log(`[+] Ready as ${client.user.tag}`);
  await loadDB();
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  // Only react to the owner
  if (newState.member?.id !== OWNER_ID && oldState.member?.id !== OWNER_ID) return;

  // Owner joined a voice channel
  if (!oldState.channelId && newState.channelId && newState.member?.id === OWNER_ID) {
    const channel = newState.guild.channels.cache.get(newState.channelId);
    if (channel) {
      await startStreaming(channel, localState.currentTime);
    }
  }
  // Owner left voice
  else if (oldState.channelId && !newState.channelId && oldState.member?.id === OWNER_ID) {
    await stopStreaming();
  }
});

client.on('messageCreate', async (message) => {
  // Only respond to own messages (selfbot style)
  if (message.author.id !== client.user.id) return;

  const content = message.content.trim();
  const args = content.split(/\s+/);
  const command = (args[0] || '').toLowerCase();

  try {
    if (command === '!setvid') {
      const url = args[1];
      if (!url) {
        await message.edit('[-] Usage: !setvid <url>');
        return;
      }
      localState.url = url;
      localState.currentTime = 0;
      localState.bookmarks = [];
      await saveDB();
      pushDBtoGitHub();
      await message.edit(`[+] Video set and saved (encrypted).`);
    }

    else if (command === '!seek') {
      const target = parseInt(args[1], 10);
      if (isNaN(target) || target < 0) {
        await message.edit('[-] Usage: !seek <seconds>');
        return;
      }
      await message.edit(`[+] Seeking to ${formatTime(target)}...`);
      await stopStreaming();
      localState.currentTime = target;
      const voiceChannel = message.member?.voice?.channel;
      if (voiceChannel) {
        await startStreaming(voiceChannel, target);
      }
    }

    else if (command === '!stop') {
      await stopStreaming();
      await message.edit(`[+] Stopped. Time saved: ${formatTime(localState.currentTime)}`);
    }

    else if (command === '!hot' || command === '!mark') {
      const note = args.slice(1).join(' ') || 'bookmark';
      localState.bookmarks.push({
        time: localState.currentTime,
        note,
      });
      await saveDB();
      pushDBtoGitHub();
      await message.edit(`🔥 Marked @ ${formatTime(localState.currentTime)} — ${note}`);
    }

    else if (command === '!marks') {
      if (localState.bookmarks.length === 0) {
        await message.edit('[-] No bookmarks yet.');
        return;
      }
      let list = '🔥 **Bookmarks:**\n';
      localState.bookmarks.forEach((bm, i) => {
        list += `${i + 1}. **${formatTime(bm.time)}** — ${bm.note}\n`;
      });
      await message.edit(list);
    }

    else if (command === '!status') {
      await message.edit(
        `Status: ${localState.isPlaying ? '▶ Playing' : '⏹ Stopped'}\n` +
        `Time: ${formatTime(localState.currentTime)}\n` +
        `URL: ${localState.url ? 'set' : 'none'}\n` +
        `Bookmarks: ${localState.bookmarks.length}`
      );
    }
  } catch (err) {
    console.error('Command error:', err.message || err);
  }
});

// ========== Bootstrap ==========
async function startBot() {
  try {
    console.log('[+] Loading video stream engine...');

    // Force load libsodium first to avoid ERR_MODULE_NOT_FOUND
    require('libsodium-wrappers');
    require('libsodium-wrappers-sumo');

    const videoStream = await import('@dank074/discord-video-stream');
    const Streamer = videoStream.Streamer || videoStream.default?.Streamer;
    streamVideo = videoStream.streamVideo || videoStream.default?.streamVideo;

    if (!Streamer || !streamVideo) {
      throw new Error('Could not find Streamer / streamVideo exports from @dank074/discord-video-stream');
    }

    streamer = new Streamer(client);
    console.log('[+] Engine loaded. Logging in...');
    await client.login(TOKEN);
  } catch (err) {
    console.error('[-] Failed to start bot:');
    console.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[+] Shutting down...');
  await stopStreaming();
  db.close();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

startBot();
