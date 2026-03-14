const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

// WhatsApp Client Setup
let waClient = null;
let clientStatus = 'Disconnected';
let qrCodeData = '';

function initWhatsApp() {
    waClient = new Client({
        authStrategy: new LocalAuth({ clientId: 'render_session' }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });

    waClient.on('qr', (qr) => {
        console.log('QR RECEIVED', qr);
        qrCodeData = qr;
        clientStatus = 'QR Code Ready';
        io.emit('status', clientStatus);
        io.emit('qr', qr);
    });

    waClient.on('ready', () => {
        console.log('Client is ready!');
        clientStatus = 'Connected';
        qrCodeData = '';
        io.emit('status', clientStatus);
    });

    waClient.on('disconnected', (reason) => {
        console.log('Client was logged out', reason);
        clientStatus = 'Disconnected';
        io.emit('status', clientStatus);
        setTimeout(initWhatsApp, 2000); // Reinitialize after 2 secs
    });

    waClient.initialize();
}

initWhatsApp();

io.on('connection', (socket) => {
    socket.emit('status', clientStatus);
    if (qrCodeData && clientStatus !== 'Connected') {
        socket.emit('qr', qrCodeData);
    }
});

// Sleep Helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Random Delay (10 to 20 seconds)
const getRandomDelay = () => Math.floor(Math.random() * (20000 - 10000 + 1) + 10000);

// API Routes

// 1. Get Status
app.get('/api/status', (req, res) => {
    res.json({ status: clientStatus });
});

// 2. Logout
app.post('/api/logout', async (req, res) => {
    if (waClient) {
        try {
            await waClient.logout();
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    } else {
        res.json({ success: false });
    }
});

// 3. Bulk Messaging
app.post('/api/bulk', upload.fields([{ name: 'csv', maxCount: 1 }, { name: 'media', maxCount: 1 }]), async (req, res) => {
    if (clientStatus !== 'Connected') {
        return res.status(400).json({ error: 'WhatsApp is not connected.' });
    }

    const { messageBody, manualNumbers, msgDelay } = req.body;
    let numbers = [];

    // Parse Manual
    if (manualNumbers) {
        numbers = manualNumbers.split(',').map(n => n.trim()).filter(n => n);
    }

    const processCampaign = async (targets) => {
        let media = null;
        if (req.files && req.files['media']) {
            media = MessageMedia.fromFilePath(req.files['media'][0].path);
        }

        // Send response early, process in background
        res.json({ success: true, message: `Processing ${targets.length} numbers.` });
        
        let sentCount = 0;
        for (const num of targets) {
            // Clean number (ensure country code, remove +, -, spaces)
            let cleanNum = num.replace(/[\+\-\s]/g, '');
            if (!cleanNum.endsWith('@c.us')) cleanNum += '@c.us';

            try {
                // Parse Variables securely
                let finalMsg = messageBody;
                // Currently just doing basic replacement, can expand if you pass names from CSV
                // Assuming Name isn't mapable from manual, we just send literal body or blank names
                
                if (media) {
                    await waClient.sendMessage(cleanNum, media, { caption: finalMsg });
                } else {
                    await waClient.sendMessage(cleanNum, finalMsg);
                }
                sentCount++;
                io.emit('log', `Sent to ${cleanNum}`);

                // User-defined sending delay
                const delay = (parseInt(msgDelay) || 5) * 1000;
                io.emit('log', `Waiting ${delay/1000}s before next message...`);
                await sleep(delay);

                // Emulate Sleep mode (Wait 5 minutes every 50 messages)
                if (sentCount % 50 === 0 && sentCount < targets.length) {
                    io.emit('log', `Sleep Mode: Taking a 5 minute rest...`);
                    await sleep(300000);
                }

            } catch (err) {
                io.emit('log', `Failed to send to ${cleanNum}: ${err.message}`);
            }
        }
        io.emit('log', `--- Campaign Finished! Total sent: ${sentCount} ---`);
    };

    if (req.files && req.files['csv']) {
        const csvPath = req.files['csv'][0].path;
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (data) => {
                const phone = data.phone || data.Phone || data.number || data.Number;
                if (phone) numbers.push(phone.toString().trim());
            })
            .on('end', () => {
                processCampaign(numbers);
            });
    } else {
        processCampaign(numbers);
    }
});

// 4. Contact Extractor
app.get('/api/extract', async (req, res) => {
    if (clientStatus !== 'Connected') {
        return res.status(400).json({ error: 'WhatsApp is not connected.' });
    }

    try {
        const chats = await waClient.getChats();
        let contactsList = [];

        for (const chat of chats) {
            if (chat.isGroup) {
                for (let participant of chat.participants) {
                    contactsList.push({
                        name: 'Group Member',
                        phone: participant.id.user,
                        source: `Group: ${chat.name}`
                    });
                }
            } else {
                const contact = await waClient.getContactById(chat.id._serialized);
                contactsList.push({
                    name: contact.name || contact.pushname || 'Unknown',
                    phone: contact.number,
                    source: 'Direct Chat'
                });
            }
        }

        // Deduplicate numbers
        const uniqueContacts = [];
        const map = new Map();
        for (const item of contactsList) {
            if(!map.has(item.phone)){
                map.set(item.phone, true);
                uniqueContacts.push(item);
            }
        }

        res.json({ success: true, count: uniqueContacts.length, contacts: uniqueContacts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve frontend routing natively to the new html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'render.html'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Render-friendly WA-404 running on port ${PORT}`);
});
