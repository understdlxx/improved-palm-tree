const { Client: DiscordClient } = require('discord.js-selfbot-v13');
const sqlite3 = require('sqlite3').verbose();
const { execSync } = require('child_process');
const crypto = require('crypto');

const TOKEN = process.env.TOKEN;
const KAMBIZ_ID = process.env.KAMBIZ_ID;

if (!TOKEN || !KAMBIZ_ID) {
    console.error('[-] Dash Kambiz, Secrets vared nashode!');
    process.exit(1);
}

// 🛡️ سیستم رمزنگاری نظامی AES-256-CBC 
const ENCRYPTION_KEY = crypto.createHash('sha256').update(TOKEN).digest();
const IV_LENGTH = 16;

function encryptData(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptData(text) {
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (err) {
        return null;
    }
}

const client = new DiscordClient({ checkUpdate: false });

let streamer;
let streamVideo;

let localState = {
    url: null, currentTime: 0, bookmarks: [],
    isPlaying: false, streamConnection: null
};

// 🧠 اتصال به دیتابیس لوکال مخفی
const db = new sqlite3.Database('./kambiz_memory.sqlite');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS encrypted_state (
        id TEXT PRIMARY KEY,
        secure_payload TEXT
    )`);
});

function loadDB() {
    return new Promise((resolve) => {
        db.get("SELECT secure_payload FROM encrypted_state WHERE id = 'main'", (err, row) => {
            if (row && row.secure_payload) {
                const decryptedStr = decryptData(row.secure_payload);
                if (decryptedStr) {
                    const parsed = JSON.parse(decryptedStr);
                    localState.url = parsed.url || null;
                    localState.currentTime = parsed.current_time || 0;
                    localState.bookmarks = parsed.bookmarks || [];
                    console.log(`[+] Hafeze az SQL baz va Ramzgoshayi shod! Saniye: ${localState.currentTime}`);
                }
            }
            resolve();
        });
    });
}

function saveDB() {
    return new Promise((resolve) => {
        const rawData = JSON.stringify({
            url: localState.url,
            current_time: localState.currentTime,
            bookmarks: localState.bookmarks
        });
        const encryptedPayload = encryptData(rawData); 
        
        const stmt = db.prepare(`INSERT OR REPLACE INTO encrypted_state (id, secure_payload) VALUES (?, ?)`);
        stmt.run('main', encryptedPayload, () => {
            stmt.finalize();
            resolve();
        });
    });
}

function pushDBtoGitHub() {
    try {
        console.log('[+] Dar hale Push kardane DB be sorate makhfiyane...');
        execSync('git config --global user.name "Ghost Bot"', { stdio: 'ignore' });
        execSync('git config --global user.email "ghost@kambiz.local"', { stdio: 'ignore' });
        execSync('git add kambiz_memory.sqlite', { stdio: 'ignore' });
        execSync('git commit -m "🤖 Auto-save Encrypted DB" || echo ""', { stdio: 'ignore' });
        execSync('git push', { stdio: 'ignore' });
        console.log('[+] DB mese rooh roye Repo Push shod! 100% Secure.');
    } catch (err) {
        console.log('[-] Push nashod (Ehtemalan taqyiri nabod).');
    }
}

function formatTime(secs) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h > 0 ? `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}` : `${m}:${s < 10 ? '0' : ''}${s}`;
}

client.on('ready', async () => {
    console.log(`[+] Mokhlesim Dash Kambiz! Bot ${client.user.username} bala oomad.`);
    await loadDB();
});

setInterval(async () => {
    if (localState.isPlaying) {
        localState.currentTime += 1;
        if (localState.currentTime % 15 === 0) await saveDB();
    }
}, 1000);

async function startStreaming(channel, startTime = 0) {
    if (!localState.url) return console.log('[-] Link nist dash!');

    try {
        await streamer.joinVoice(channel.guild.id, channel.id);
        const udp = await streamer.createStream();
        
        udp.mediaConnection.setSpeaking(true);
        udp.mediaConnection.setVideoStatus(true);
        localState.streamConnection = udp;

        let ffmpegArgs = `-re -ss ${startTime} -preset ultrafast -tune zerolatency -max_muxing_queue_size 1024 -threads 4`;
        
        console.log(`[>>] Pakhsh az ${formatTime(startTime)}...`);
        streamVideo(localState.url, udp, ffmpegArgs, { width: 1280, height: 720, fps: 30, bitrateKbps: 3000 });
        
        localState.isPlaying = true;
        localState.currentTime = startTime;

    } catch (err) {
        console.error('[-] Ride shod to stream:', err);
    }
}

async function stopStreaming() {
    if (localState.streamConnection) {
        localState.streamConnection.mediaConnection.setSpeaking(false);
        localState.streamConnection.mediaConnection.setVideoStatus(false);
    }
    streamer.leaveVoice();
    localState.isPlaying = false;
    
    await saveDB(); 
    pushDBtoGitHub(); 
    
    console.log(`[||] Stream stop shod. DB Ramznegarishode push shod. Time: ${formatTime(localState.currentTime)}`);
}

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.member.id !== KAMBIZ_ID) return;

    if (!oldState.channelId && newState.channelId) {
        const channel = newState.guild.channels.cache.get(newState.channelId);
        await startStreaming(channel, localState.currentTime);
    } 
    else if (oldState.channelId && !newState.channelId) {
        await stopStreaming();
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.id !== client.user.id) return;
    const args = message.content.split(' ');
    const command = args[0].toLowerCase();

    if (command === '!setvid') {
        localState.url = args[1];
        localState.currentTime = 0;
        localState.bookmarks = [];
        await saveDB();
        pushDBtoGitHub();
        message.edit(`[+] Link set shod va be sorate Ramzngarishode DB to GitHub push shod!`);
    }

    if (command === '!seek') {
        const targetSecond = parseInt(args[1]);
        if (isNaN(targetSecond)) return;
        message.edit(`[+] Dar hale paresh be ${formatTime(targetSecond)}...`);
        await stopStreaming();
        localState.currentTime = targetSecond;
        if (message.member?.voice?.channel) startStreaming(message.member.voice.channel, targetSecond);
    }

    if (command === '!stop') {
        await stopStreaming();
        message.edit(`[+] Tormoz! Time save shod: ${formatTime(localState.currentTime)}`);
    }

    if (command === '!hot') {
        let note = args.slice(1).join(' ') || 'Sokan-se nab';
        localState.bookmarks.push({ time: localState.currentTime, note: note });
        await saveDB(); 
        pushDBtoGitHub(); 
        message.edit(`🔥 Mark shod! ${formatTime(localState.currentTime)}`);
    }
    
    if (command === '!marks') {
        if (localState.bookmarks.length === 0) return message.edit('[-] Hich markii nist!');
        let list = '🔥 **Jahaye Save Shode:**\n';
        localState.bookmarks.forEach((bm, i) => list += `${i+1}. Time: **${formatTime(bm.time)}** | Note: ${bm.note}\n`);
        message.edit(list);
    }
});

// ⚡ هسته‌ی اصلی ربات: اجرای داینامیک و امن
async function startBot() {
    try {
        console.log('[+] Dar hale load kardane engine stream...');
        const videoStream = await import('@dank074/discord-video-stream');
        const Streamer = videoStream.Streamer;
        streamVideo = videoStream.streamVideo;
        
        streamer = new Streamer(client);
        
        console.log('[+] Engine load shod. Dar hale vasl shodan be Discord...');
        await client.login(TOKEN);
    } catch (err) {
        console.error('[-] Ride shod to load kardane engine:', err);
    }
}

// استارت موتور!
startBot();
