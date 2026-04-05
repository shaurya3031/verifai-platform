require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const os = require('os');
const Parser = require('rss-parser');
const db = require('./db');

const app = express();
const parser = new Parser({
    customFields: {
        item: ['source']
    }
});
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const cron = require('node-cron');
const axios = require('axios');
const { exec } = require('child_process');

let lastFetchTime = 0;
const FETCH_THROTTLE = 10 * 60 * 1000; // 10 minutes (to avoid spamming Google News)

const PORT = process.env.PORT || 3000;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

// --- Environment Validation ---
const REQUIRED_ENV = ['NVIDIA_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CX'];
const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.warn(`\n  ⚠️  WARNING: Missing some environment variables: ${missingEnv.join(', ')}`);
    console.warn('  Some AI verification features may be limited, but the platform will still run.');
}

// ==========================================
// 🛡️ API SECURITY (Loaded from .env)
// ==========================================

// Deduplication track
const lastBroadcastedTitles = new Set();
const MAX_HISTORY = 50;
let recentClaims = []; // Store last 10 unique claims

// Middleware
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like local files or curl)
        if (!origin) return callback(null, true);
        
        // Allow any localhost, 127.0.0.1, or common local ports (covers Live Server 5500/5501)
        const allowedPorts = [':3000', ':5500', ':5501', ':8080'];
        const allowedDomains = ['localhost', '127.0.0.1', 'render.com', 'railway.app'];
        
        const isAllowed = allowedDomains.some(d => origin.includes(d)) || allowedPorts.some(p => origin.includes(p));
        
        if (isAllowed) {
            return callback(null, true);
        }
        callback(new Error(`CORS Error: Origin ${origin} is not allowed.`));
    },
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==========================================
// NVIDIA NIM API Proxy
// ==========================================
app.post('/api/nvidia', async (req, res) => {
    const { claim_id, model_name } = req.body;
    
    // Check Cache
    if (claim_id && model_name) {
        try {
            const cached = await db.getVerification(claim_id, model_name);
            if (cached) {
                console.log(`🎯 Cache Hit: ${claim_id} (${model_name})`);
                return res.json({ 
                    choices: [{ message: { content: cached.explanation } }],
                    cached: true,
                    verdict: cached.verdict,
                    confidence: cached.confidence
                });
            }
        } catch (dbErr) {
            console.error('Cache read error:', dbErr.message);
        }
    }

    try {
        // Create a clean request body for NVIDIA (remove internal metadata)
        const { claim_id: _, model_name: __, isTrusted: ___, ...nvidiaBody } = req.body;
        
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${NVIDIA_API_KEY}`
            },
            body: JSON.stringify(nvidiaBody)
        });

        const data = await response.json();
        
        // Save to Cache if successful
        if (response.ok && claim_id && model_name && data.choices && data.choices[0]) {
            const content = data.choices[0].message.content;
            await db.saveVerification({
                claim_id,
                user_email: req.body.user_email || 'guest',
                model: model_name,
                verdict: 'Analyzed',
                explanation: content,
                confidence: 85
            }).catch(e => console.error('Cache save error:', e.message));
        }

        res.status(response.status).json(data);
    } catch (error) {
        console.error('NVIDIA API proxy error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// Google Custom Search Proxy
// ==========================================
app.get('/api/google-search', async (req, res) => {
    if (!GOOGLE_API_KEY || !GOOGLE_CX) {
        return res.status(200).json({ items: [] });
    }

    try {
        const query = encodeURIComponent(req.query.q || '');
        const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${query}&num=5`;

        const response = await fetch(url);
        if (response.status === 403) {
            console.error('❌ Google Search error: 403 Forbidden (Check API key quota/restriction)');
            return res.status(403).json({ error: 'Google API quota exceeded or unauthorized.' });
        }
        const data = await response.text();
        res.status(response.status).set('Content-Type', 'application/json').send(data);
    } catch (error) {
        console.error('❌ Google Search proxy error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 🗞️ Real-time News Ingestion (Google RSS)
// ==========================================
async function fetchLatestNewsAndVerify() {
    console.log('🔄 Cron: Fetching latest global news from Google News parser...');
    
    try {
        const feed = await parser.parseURL('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en');
        
        if (feed.items && feed.items.length > 0) {
            // Find ALL ones that haven't been broadcasted
            const newMatches = feed.items.slice(0, 10).filter(item => !lastBroadcastedTitles.has(item.title));
            
            newMatches.forEach(item => {
                lastBroadcastedTitles.add(item.title);
                if (lastBroadcastedTitles.size > MAX_HISTORY) {
                    const first = lastBroadcastedTitles.values().next().value;
                    lastBroadcastedTitles.delete(first);
                }

                const claimId = 'rss-' + item.title.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 50);
                const claimData = {
                    claim: item.title,
                    timestamp: item.isoDate || new Date(item.pubDate).toISOString(),
                    id: claimId,
                    source: (typeof item.source === 'object') ? item.source._ : (item.source || 'News'),
                    category: 'world'
                };
                
                // Save to Database
                db.saveNewsItem(claimData).catch(e => console.error('DB News Save error:', e.message));
                
                recentClaims.unshift(claimData);
                if (recentClaims.length > 10) recentClaims.pop();

                io.emit('new-claim-detected', claimData);
                console.log(`📡 Broadcasted NEW claim: "${item.title}"`);
            });
        }
    } catch (error) {
        console.error('❌ RSS Fetch error:', error.message);
    } finally {
        lastFetchTime = Date.now();
    }
}

// Check for new news every 1 minute
cron.schedule('*/1 * * * *', () => {
    fetchLatestNewsAndVerify();
});

// Socket.io Connection
io.on('connection', (socket) => {
    console.log(`🔌 New client connected: ${socket.id} (Syncing ${recentClaims.length} claims)`);
    
    // Auto-refresh news on lands if stale
    const now = Date.now();
    if (now - lastFetchTime > FETCH_THROTTLE) {
        console.log('⚡ User landed and data is stale (>10m). Triggering auto-refresh...');
        fetchLatestNewsAndVerify();
    }

    // Sync latest claims history immediately
    if (recentClaims.length > 0) {
        socket.emit('initial-claims', recentClaims);
    }

    socket.on('disconnect', () => console.log('👋 Client disconnected'));
});

// ==========================================
// 📰 Categorized News API
// ==========================================
const CATEGORY_FEEDS = {
    world: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en',
    war: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en',
    politics: 'https://news.google.com/rss/headlines/section/topic/POLITICS?hl=en-US&gl=US&ceid=US:en',
    innovation: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en',
    disasters: 'https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en'
};

app.get('/api/news', async (req, res) => {
    const category = req.query.category || 'world';
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const feedUrl = CATEGORY_FEEDS[category] || CATEGORY_FEEDS.world;

    try {
        const feed = await parser.parseURL(feedUrl);
        
        const allItems = feed.items.map(item => ({
            title: item.title,
            description: item.contentSnippet || item.content,
            link: item.link,
            timestamp: item.isoDate || item.pubDate,
            source: (typeof item.source === 'object') ? item.source._ : (item.source || 'News')
        }));

        // Pagination
        const start = (page - 1) * limit;
        const pagedItems = allItems.slice(start, start + limit);

        res.json({
            category,
            page,
            total: allItems.length,
            items: pagedItems,
            hasMore: allItems.length > start + limit
        });
    } catch (error) {
        console.error(`❌ News Fetch error (${category}):`, error.message);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 🔄 On-Demand News Refresh API
// ==========================================
app.post('/api/news/refresh', async (req, res) => {
    try {
        console.log('⚡ User-triggered News Refresh...');
        await fetchLatestNewsAndVerify();
        res.json({ success: true, message: 'Latest news fetched successfully.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// ==========================================
// Fact Check Search Proxy
// ==========================================
app.get('/api/fact-check', async (req, res) => {
    try {
        const query = encodeURIComponent(req.query.q || '');
        const url = `https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${query}&key=${GOOGLE_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 🕒 News History API
// ==========================================
app.get('/api/history', async (req, res) => {
    try {
        const history = await db.getLatestNews(50);
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user-history', async (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const history = await db.getUserHistory(email, 50);
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 📊 Analytics API
// ==========================================
app.get('/api/analytics', async (req, res) => {
    try {
        const stats = await db.getAnalytics();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ⚙️ Configuration API
// ==========================================
app.get('/api/config/firebase', async (req, res) => {
    try {
        const config = await db.getConfig('firebase');
        if (config) {
            res.json(config);
        } else {
            res.status(404).json({ error: 'Firebase configuration not found in relational database.' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/config/firebase', async (req, res) => {
    try {
        await db.saveConfig('firebase', req.body);
        res.json({ success: true, message: 'Firebase configuration saved in relational database.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const server = http.listen(PORT, '0.0.0.0', async () => {
    // Initialize Firestore Database
    await db.initDatabase().catch(e => console.error('DB Init error:', e.message));
    const interfaces = os.networkInterfaces();
    let localIp = 'localhost';
    
    // Find the real local IP (e.g., 192.168.x.x)
    for (const devName in interfaces) {
        for (const iface of interfaces[devName]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIp = iface.address;
                break;
            }
        }
    }

    const localUrl = `http://localhost:${PORT}`;
    const networkUrl = `http://${localIp}:${PORT}`;

    console.log(`\n  ✅  VerifAI Always-On Server is LIVE!`);
    console.log(`  🌐  Local Access:   ${localUrl}`);
    console.log(`  📱  Network Access: ${networkUrl} (Share this with others on your Wi-Fi!)`);
    console.log(`  🤖  3 AI Models ready (Llama 3.1, Mistral, Nemotron)`);
    console.log(`  🔑  NVIDIA API Key: ${NVIDIA_API_KEY ? '✓ configured' : '✗ missing'}`);
    
    // Initial fetch to populate news immediately
    await fetchLatestNewsAndVerify().catch(e => console.error('Initial Fetch error:', e.message));

    console.log(`\n🚀  VerifAI is ready for requests!`);
});

// --- Port Conflict Handling ---
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`\n❌ PORT CONFLICT ERROR: Port ${PORT} is already being used!`);
        console.error(`💡 FIX: Run 'repair-verifai.bat' or kill the other app using this port.`);
        process.exit(1);
    }
});
