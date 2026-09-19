const { Client } = require('discord.js-selfbot-v13');
const { Streamer, streamVideo } = require('@dank074/discord-video-stream');

const TOKEN = process.env.TOKEN;
const KAMBIZ_ID = process.env.KAMBIZ_ID;
const GH_TOKEN = process.env.GH_TOKEN; // توکن شخصی گیت‌هاب تو
const GIST_ID = process.env.GIST_ID;   // آیدی فایل مخفی

if (!TOKEN || !GH_TOKEN || !GIST_ID) {
    console.error('[-] Dash Kambiz, ye chizi to Secrets kamo kasrie!');
    process.exit(1);
}

const client = new Client({ checkUpdate: false });
const streamer = new Streamer(client);

let localState = {
    url: null, currentTime: 0, bookmarks: [],
    isPlaying: false, timer: null, streamConnection: null
};

// 🧠 هوش مصنوعی برای خوندن حافظه از فایل مخفی (Gist)
async function loadStateFromGist() {
    try {
        const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            headers: { 'Authorization': `Bearer ${GH_TOKEN}` }
        });
        const data = await res.json();
        const content = data.files['kambiz_memory.json'].content;
        const parsed = JSON.parse(content);
        
        localState.url = parsed.url || null;
        localState.currentTime = parsed.currentTime || 0;
        localState.bookmarks = parsed.bookmarks || [];
        console.log(`[+] Hafeze bazyabi shod! Akharin bar saniye ${localState.currentTime} bodi.`);
    } catch (err) {
        console.log('[-] Hafeze khaliye ya taze sakhti. Moshkeli nist.');
    }
}

// 🧠 هوش مصنوعی برای سیو کردن حافظه تو فایل مخفی (بدون لیک شدن)
async function saveStateToGist() {
    try {
        const payload = {
            url: localState.url,
            currentTime: localState.currentTime,
            bookmarks: localState.bookmarks
        };
        await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${GH_TOKEN}`,
                'Accept': 'application/vnd.github+json'
            },
            body: JSON.stringify({
                files: {
                    'kambiz_memory.json': { content: JSON.stringify(payload) }
                }
            })
        });
    } catch (err) {
        console.error('[-] Nashod to Gist save konam:', err);
    }
}

function formatTime(secs) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h > 0 ? `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}` : `${m}:${s < 10 ? '0' : ''}${s}`;
}

client.on('ready', async () => {
    console.log(`[+] Mokhlesim Dash Kambiz! Bot ${client.user.username} bala oomad.`);
    await loadStateFromGist(); // اول کار حافظه رو می‌خونه
});

async function startStreaming(channel, startTime = 0) {
    if (!localState.url) return console.log('[-] Link nist dash!');

    try {
        await streamer.joinVoice(channel.guild.id, channel.id);
        const udp = await streamer.createStream();
        
        udp.mediaConnection.setSpeaking(true);
        udp.mediaConnection.setVideoStatus(true);
        localState.streamConnection = udp;

        // 🚀 موتور استریم رو فول‌پاور کردم: بدون لگ، بافر قوی‌تر
        let ffmpegArgs = `-re -ss ${startTime} -preset ultrafast -tune zerolatency -max_muxing_queue_size 1024 -probesize 32M -analyzeduration 10M -threads 4`;
        
        console.log(`[>>] Pakhsh az ${formatTime(startTime)} ba balatarin keyfiyat...`);
        streamVideo(localState.url, udp, ffmpegArgs, { width: 1280, height: 720, fps: 30, bitrateKbps: 3000 });
        
        localState.isPlaying = true;
        localState.currentTime = startTime;

        if (localState.timer) clearInterval(localState.timer);
        localState.timer = setInterval(async () => {
            localState.currentTime += 1;
            // هر 15 ثانیه سیو میکنه تو گیت‌هاب که محدودیت API نخوره
            if (localState.currentTime % 15 === 0) {
                await saveStateToGist(); 
            }
        }, 1000);

    } catch (err) {
        console.error('[-] Ride shod to stream:', err);
    }
}

function stopStreaming() {
    if (localState.timer) clearInterval(localState.timer);
    if (localState.streamConnection) {
        localState.streamConnection.mediaConnection.setSpeaking(false);
        localState.streamConnection.mediaConnection.setVideoStatus(false);
    }
    streamer.leaveVoice();
    localState.isPlaying = false;
    saveStateToGist(); // سیو نهایی موقع خروج
    console.log(`[||] Stream stop shod. Time to Gist save shod: ${formatTime(localState.currentTime)}`);
}

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.member.id !== KAMBIZ_ID) return;

    if (!oldState.channelId && newState.channelId) {
        const channel = newState.guild.channels.cache.get(newState.channelId);
        await startStreaming(channel, localState.currentTime);
    } 
    else if (oldState.channelId && !newState.channelId) {
        stopStreaming();
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
        await saveStateToGist();
        message.edit(`[+] Link set shod va to hafeze makhfi save shod!`);
    }

    if (command === '!seek') {
        const targetSecond = parseInt(args[1]);
        if (isNaN(targetSecond)) return;
        message.edit(`[+] Dar hale paresh be ${formatTime(targetSecond)}...`);
        stopStreaming();
        localState.currentTime = targetSecond;
        if (message.member?.voice?.channel) startStreaming(message.member.voice.channel, targetSecond);
    }

    if (command === '!stop') {
        stopStreaming();
        message.edit(`[+] Tormoz! Time save shod: ${formatTime(localState.currentTime)}`);
    }

    if (command === '!hot') {
        let note = args.slice(1).join(' ') || 'Sokan-se nab';
        localState.bookmarks.push({ time: localState.currentTime, note: note });
        await saveStateToGist(); 
        message.edit(`🔥 Mark shod to hafeze makhfi! ${formatTime(localState.currentTime)}`);
    }
    
    if (command === '!marks') {
        if (localState.bookmarks.length === 0) return message.edit('[-] Hich markii nist!');
        let list = '🔥 **Jahaye Save Shode:**\n';
        localState.bookmarks.forEach((bm, i) => list += `${i+1}. Time: **${formatTime(bm.time)}** | Note: ${bm.note}\n`);
        message.edit(list);
    }
});

client.login(TOKEN);
