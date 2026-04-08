/* ============================================
   VerifAI — News Verification Platform
   Application Logic
   ============================================ */

// ==========================================
// 🔑 API KEYS — Now handled by server.js proxy
// ==========================================

// Proxy API endpoints (detects if running on Live Server or direct)
const getBackendUrl = () => {
    // If we're on a standard cloud port (none) or already on 3000, use relative paths
    if (window.location.port === '3000' || !window.location.port) return '';
    // Otherwise (local dev on 5500/5501), target the local backend on 3000
    return `${window.location.protocol}//${window.location.hostname}:3000`;
};

// Simple hash for claim uniqueness
const getClaimHash = (text) => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16);
};

const BACKEND_URL = getBackendUrl();
const NVIDIA_PROXY_URL = `${BACKEND_URL}/api/nvidia`;
const GOOGLE_PROXY_URL = `${BACKEND_URL}/api/google-search`;

// Socket setup
let socket;
try {
    socket = io(BACKEND_URL, { autoConnect: false });
    setupSocketListeners();
    socket.connect();
} catch (e) {
    console.error('Socket.io not found, running without real-time updates', e);
}

// AI Model configurations
const AI_MODELS = {
    llama: {
        id: 'meta/llama-3.1-8b-instruct',
        name: 'Llama 3.1',
        role: 'Fact Analysis',
        systemPrompt: `You are a professional fact-checker. Analyze the following news claim for factual accuracy.
        
        CRITICAL: Ignore minor typos, spelling mistakes, or informal language in the user's input. Look past the "typing style" and focus purely on the factual substance of the underlying claim.
        
        Your response MUST be in this exact JSON format:
        {
          "verdict": "TRUE" | "FALSE" | "PARTIALLY TRUE" | "UNVERIFIABLE",
          "confidence": <number 0-100>,
          "analysis": "<2-3 sentence analysis of the claim's factual basis>",
          "key_points": ["<point 1>", "<point 2>", "<point 3>"],
          "red_flags": ["<flag 1>"] 
        }
        
        Be objective, fact-based, and concise. Only output valid JSON.`
    },
    mistral: {
        id: 'mistralai/mistral-small-24b-instruct',
        name: 'Mistral',
        role: 'Source Credibility',
        systemPrompt: `You are a media credibility analyst. Evaluate the likely source credibility of the following news claim.
        
        CRITICAL: Ignore minor typos or informal phrasing. Do not penalize a claim based on the user's typing style. Focus on whether the core information typically originates from credible or dubious sources.
        
        Your response MUST be in this exact JSON format:
        {
          "credibility": "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN",
          "confidence": <number 0-100>,
          "analysis": "<2-3 sentence assessment of source credibility and typical patterns>",
          "indicators": ["<indicator 1>", "<indicator 2>", "<indicator 3>"],
          "typical_sources": ["<source type 1>", "<source type 2>"]
        }
        
        Focus on journalistic standards, source patterns, and core claim credibility. Only output valid JSON.`
    },
    nemotron: {
        id: 'nvidia/nemotron-mini-4b-instruct',
        name: 'Nemotron',
        role: 'Bias Detection',
        systemPrompt: `You are a media bias analyst. Detect potential biases in the following news claim.
        
        CRITICAL: Distinguish between "user typos" and "systemic media bias". Ignore the user's typing style and focus on whether the underlying news event or statement is presented with emotional, partisan, or skewed framing in general media.
        
        Your response MUST be in this exact JSON format:
        {
          "bias_level": "NONE" | "LOW" | "MODERATE" | "HIGH",
          "bias_types": ["<type 1>"],
          "confidence": <number 0-100>,
          "analysis": "<2-3 sentence bias assessment>",
          "emotional_language": ["<word/phrase 1>"],
          "suggestion": "<one sentence recommendation for the reader>"
        }
        
        Be analytical and impartial. Only output valid JSON.`
    },
};

// ==========================================
// DOM Elements
// ==========================================
const claimInput = document.getElementById('claimInput');
const charCount = document.getElementById('charCount');
const verifyBtn = document.getElementById('verifyBtn');
const resultsArea = document.getElementById('resultsArea');
const navbar = document.getElementById('navbar');
const liveFeedList = document.getElementById('liveFeedList');
const exportPdfBtn = document.getElementById('exportPdfBtn');

// Model elements
const modelElements = {
    llama: {
        card: document.getElementById('llamaCard'),
        status: document.getElementById('llamaStatus'),
        body: document.getElementById('llamaBody')
    },
    mistral: {
        card: document.getElementById('mistralCard'),
        status: document.getElementById('mistralStatus'),
        body: document.getElementById('mistralBody')
    },
    nemotron: {
        card: document.getElementById('nemotronCard'),
        status: document.getElementById('nemotronStatus'),
        body: document.getElementById('nemotronBody')
    },
};

const googleStatus = document.getElementById('googleStatus');
const sourcesBody = document.getElementById('sourcesBody');
const gaugeFill = document.getElementById('gaugeFill');
const gaugeNumber = document.getElementById('gaugeNumber');
const verdictLabel = document.getElementById('verdictLabel');
const verdictSummary = document.getElementById('verdictSummary');
const verdictTags = document.getElementById('verdictTags');
const fileUpload = document.getElementById('fileUpload');
const referenceChipContainer = document.getElementById('referenceChipContainer');
const userProfile = document.getElementById('userProfile');
const userEmailDisplay = document.getElementById('userEmailDisplay');
const logoutBtn = document.getElementById('logoutBtn');
const userHistoryList = document.getElementById('userHistoryList');

let selectedFile = null;
let selectedFileDataUrl = null; // base64 data URL for vision analysis
let currentUser = null;


// --- Auth State Monitoring (Reflect user info only) ---
const initAuthProfile = () => {
    if (!window.firebase) return;

    firebase.auth().onAuthStateChanged((user) => {
        if (user) {
            currentUser = user;
            if (userProfile) userProfile.style.display = 'flex';
            if (userEmailDisplay) userEmailDisplay.textContent = user.email;

            const navLoadingChip = document.getElementById('navLoadingChip');
            if (navLoadingChip) navLoadingChip.style.display = 'none';

            fetchUserHistory(user.email);
            console.log('👤 Profile Sync:', user.email);
        }
    });
};

// --- Personalized History Fetching ---
const fetchUserHistory = async (email) => {
    try {
        const res = await fetch(`/api/user-history?email=${encodeURIComponent(email)}`);
        const history = await res.json();
        renderUserHistory(history);
    } catch (err) {
        console.error('Error fetching user history:', err);
    }
};

const renderUserHistory = (history) => {
    // Render the main history list (used on old index.html, kept for compatibility)
    if (userHistoryList) {
        if (history.length === 0) {
            userHistoryList.innerHTML = `
                <div class="feed-placeholder glass" style="grid-column: 1/-1; padding: 40px; text-align: center;">
                    <p>No recent verifications found for your account.</p>
                </div>
            `;
        } else {
            userHistoryList.innerHTML = history.map(item => `
                <div class="history-card glass reveal active">
                    <div class="card-header">
                        <span class="card-date">${new Date(item.date).toLocaleDateString()}</span>
                        <span class="verdict-badge verdict-${(item.verdict || 'unknown').toLowerCase()}">${item.verdict}</span>
                    </div>
                    <p class="card-claim">${item.claim_id.replace(/-/g, ' ')}</p>
                    <div class="card-footer">
                        <span class="model-tag">${item.model}</span>
                        <div class="confidence-bar">
                            <div class="confidence-fill" style="width: ${item.confidence}%"></div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }

    // Also populate the sidebar (defined in verification.html)
    if (typeof window.renderSidebarHistory === 'function') {
        window.renderSidebarHistory(history);
    }
};

// --- File Reference Handling ---
const initFileHandling = () => {
    if (!fileUpload) return;

    fileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        selectedFile = file;
        selectedFileDataUrl = null;

        // Read image as base64 immediately for vision analysis
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                selectedFileDataUrl = ev.target.result; // data:image/...;base64,...
                renderFileChip(file.name, true);
            };
            reader.readAsDataURL(file);
        } else {
            renderFileChip(file.name, false);
        }
    });
};

const renderFileChip = (filename, isImage = false) => {
    if (!referenceChipContainer) return;
    const badge = isImage
        ? '<span style="font-size:0.65rem;color:var(--accent-cyan);font-weight:700;background:rgba(56,189,248,0.1);padding:2px 6px;border-radius:4px;">Vision AI</span>'
        : '<span style="font-size:0.65rem;color:var(--text-muted);font-weight:700;">File</span>';

    referenceChipContainer.innerHTML = `
        <div class="reference-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.82-2.82l8.49-8.48"/></svg>
            <span style="max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${filename}</span>
            ${badge}
            <button id="clearFile" title="Remove reference">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        </div>
    `;

    document.getElementById('clearFile').onclick = () => {
        selectedFile = null;
        selectedFileDataUrl = null;
        fileUpload.value = '';
        referenceChipContainer.innerHTML = '';
    };
};

// --- Auto-Fill Handler ---
const autoFillFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const claim = params.get('claim') || localStorage.getItem('pendingClaim');

    if (claim && claimInput) {
        console.log('📝 Auto-filling claim:', claim);
        claimInput.value = claim;
        charCount.textContent = claim.length;
        verifyBtn.disabled = claim.length < 10;

        // Clear storage
        localStorage.removeItem('pendingClaim');

        // Scroll to input
        setTimeout(() => {
            claimInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            claimInput.focus();
        }, 500);
    }
};

// --- Workspace News Feed (Right Sidebar) ---
let currentNewsCategory = 'world';

const initWorkspaceNews = () => {
    const newsTabs = document.getElementById('workspaceNewsTabs');
    if (!newsTabs) return;

    newsTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.news-tab');
        if (!tab || tab.classList.contains('active')) return;

        newsTabs.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        currentNewsCategory = tab.dataset.category;
        loadWorkspaceNews(currentNewsCategory);
    });

    // Initial load
    loadWorkspaceNews(currentNewsCategory);

    // Refresh every 2 minutes
    setInterval(() => loadWorkspaceNews(currentNewsCategory), 120000);
};

const loadWorkspaceNews = async (category) => {
    const feedList = document.getElementById('newsFeedList');
    if (!feedList) return;

    try {
        const res = await fetch(`${BACKEND_URL}/api/news?category=${category}&page=1`);
        const data = await res.json();

        if (data.items && data.items.length > 0) {
            renderWorkspaceNews(data.items);
        }
    } catch (err) {
        console.error('Error loading workspace news:', err);
    }
};

const renderWorkspaceNews = (items) => {
    const feedList = document.getElementById('newsFeedList');
    if (!feedList) return;

    // Use escapeHtml from app.js utilities
    feedList.innerHTML = items.slice(0, 8).map(item => `
        <div class="compact-news-card">
            <div class="compact-news-title">${escapeHtml(item.title)}</div>
            <div class="compact-news-footer">
                <span class="compact-news-source">${escapeHtml(item.source || 'General')}</span>
                <button class="compact-verify-btn" onclick="handleVerifyNow('${escapeHtml(item.title).replace(/'/g, "\\'")}')">Verify</button>
            </div>
        </div>
    `).join('');
};

// Handle "Verify" click from within the workspace feed
window.handleVerifyNow = (claim) => {
    if (claimInput) {
        claimInput.value = claim;
        charCount.textContent = claim.length;
        verifyBtn.disabled = claim.length < 10;
        claimInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        claimInput.focus();

        // Visual feedback
        claimInput.parentElement.style.boxShadow = '0 0 25px rgba(56, 189, 248, 0.4)';
        setTimeout(() => {
            claimInput.parentElement.style.boxShadow = '';
        }, 1200);
    }
};

// ==========================================
// 🚀 Advanced Animation Engine
// ==========================================

// --- Intersection Observer for Scroll Reveals ---
const initScrollReveals = () => {
    const revealOptions = {
        threshold: 0.15,
        rootMargin: '0px 0px -50px 0px'
    };

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                // Optional: Stop observing after reveal
                // revealObserver.unobserve(entry.target);
            }
        });
    }, revealOptions);

    document.querySelectorAll('.reveal, .text-reveal').forEach(el => {
        revealObserver.observe(el);
    });
};

// --- Mouse Tracking for Glow Effect ---
const initMouseTracking = () => {
    document.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;
        document.documentElement.style.setProperty('--mouse-x', `${x}%`);
        document.documentElement.style.setProperty('--mouse-y', `${y}%`);
    });
};

// --- Magnetic Buttons ---
const initMagneticButtons = () => {
    const magneticEls = document.querySelectorAll('.magnetic');

    magneticEls.forEach(el => {
        el.addEventListener('mousemove', function (e) {
            const rect = this.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;

            this.style.transform = `translate(${x * 0.3}px, ${y * 0.5}px)`;
            this.style.transition = 'transform 0.1s ease-out';
        });

        el.addEventListener('mouseleave', function () {
            this.style.transform = 'translate(0, 0)';
            this.style.transition = 'transform 0.5s cubic-bezier(0.23, 1, 0.32, 1)';
        });
    });
};

// --- Navbar Scroll Effect ---
if (navbar) {
    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });
}

// --- Initialization Logic ---
const initApp = () => {
    initScrollReveals();
    initMouseTracking();
    initMagneticButtons();
    initAuthProfile();
    initFileHandling();
    initWorkspaceNews();
    autoFillFromUrl();

    // Initial reveal for hero
    setTimeout(() => {
        const heroReveals = document.querySelectorAll('#home .reveal');
        heroReveals.forEach(el => el.classList.add('active'));
    }, 100);
};

// --- Initialize All ---
document.addEventListener('DOMContentLoaded', initApp);

// ==========================================
// Input Handling
// ==========================================
if (claimInput) {
    claimInput.addEventListener('input', () => {
        const len = claimInput.value.trim().length;
        if (charCount) charCount.textContent = len;
        if (verifyBtn) verifyBtn.disabled = len < 10;
    });
}

// ==========================================
// NVIDIA NIM API Call
// ==========================================
async function queryNvidiaModel(modelKey, claim) {
    const model = AI_MODELS[modelKey];
    const elements = modelElements[modelKey];

    // Set loading state
    setModelStatus(elements, 'loading');
    setModelBody(elements, createShimmer());

    try {
        const response = await fetch(NVIDIA_PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                claim_id: currentClaimId,
                user_email: currentUser ? currentUser.email : 'guest',
                model_name: modelKey,
                model: model.id,
                messages: [
                    { role: 'system', content: model.systemPrompt },
                    { role: 'user', content: `Analyze this claim: "${claim}"` }
                ],
                temperature: 0.3,
                max_tokens: 1024,
                top_p: 0.9
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        // Try to parse JSON from response
        let parsed;
        try {
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
            parsed = JSON.parse(jsonMatch[1].trim());
        } catch {
            parsed = { analysis: content, confidence: 50 };
        }

        // Add cache indicator to parsed data
        if (data.cached) {
            parsed.fromCache = true;
        }

        setModelStatus(elements, 'done');
        renderModelResult(modelKey, elements, parsed);
        return parsed;

    } catch (error) {
        console.error(`${model.name} error:`, error);
        setModelStatus(elements, 'error');
        setModelBody(elements, `
            <div style="color: var(--accent-red); padding: 12px; background: rgba(239,68,68,0.1); border-radius: 8px;">
                <strong>Error:</strong> ${error.message.substring(0, 200)}
            </div>
        `);
        return { confidence: 0, error: true };
    }
}

// ==========================================
// Google Custom Search API
// ==========================================
async function searchGoogle(claim) {
    setStatus(googleStatus, 'loading');
    sourcesBody.innerHTML = createShimmer();

    try {
        const query = encodeURIComponent(claim);
        const url = `${GOOGLE_PROXY_URL}?q=${query}`;

        const response = await fetch(url);
        // Handle 403 gracefully without throwing
        if (response.status === 403) {
            console.warn('⚠️ Google Search: 403 Forbidden (Quota exceeded)');
            setStatus(googleStatus, 'error');
            sourcesBody.innerHTML = `<div class="model-placeholder">Search quota exceeded. Analysis will continue using AI models only.</div>`;
            return [];
        }

        if (!response.ok) throw new Error(`Google API Error: ${response.status}`);

        const data = await response.json();
        const items = data.items || [];
        setStatus(googleStatus, 'done');
        renderSources(items);
        return items;
    } catch (error) {
        console.error('❌ Google Search Error:', error.message);
        setStatus(googleStatus, 'error');
        sourcesBody.innerHTML = `<div class="model-placeholder">Web search temporarily unavailable.</div>`;
        return [];
    }
}

// ==========================================
// Render Functions
// ==========================================
function setModelStatus(elements, status) {
    const indicator = elements.status.querySelector('.status-indicator');
    indicator.className = `status-indicator ${status}`;
}

function setStatus(statusEl, status) {
    const indicator = statusEl.querySelector('.status-indicator');
    indicator.className = `status-indicator ${status}`;
}

function setModelBody(elements, html) {
    elements.body.innerHTML = html;
}

function createShimmer() {
    return `
        <div class="shimmer shimmer-line" style="width: 90%"></div>
        <div class="shimmer shimmer-line" style="width: 75%"></div>
        <div class="shimmer shimmer-line" style="width: 85%"></div>
        <div class="shimmer shimmer-line" style="width: 60%"></div>
    `;
}

function renderModelResult(modelKey, elements, data) {
    let html = '';

    if (data.analysis) {
        let cacheBadge = data.fromCache ? `<span class="verdict-tag neutral" style="font-size:0.6rem; padding: 2px 6px; margin-bottom: 8px; display:inline-block;">⚡ CALIBRATED FROM CACHE</span>` : '';
        html += `${cacheBadge}<div class="analysis-text">${escapeHtml(data.analysis)}</div>`;
    }

    // Render specific fields based on model
    if (modelKey === 'llama') {
        if (data.verdict) {
            const verdictClass = data.verdict === 'TRUE' ? 'true' : data.verdict === 'FALSE' ? 'false' : 'mixed';
            html += `<div style="margin-top: 12px;"><span class="verdict-tag ${verdictClass}">${data.verdict}</span></div>`;
        }
        if (data.key_points && data.key_points.length) {
            html += `<ul style="margin-top:12px; padding-left:18px; color: var(--text-secondary); font-size:0.85rem;">`;
            data.key_points.forEach(p => { html += `<li style="margin-bottom:4px;">${escapeHtml(p)}</li>`; });
            html += `</ul>`;
        }
        if (data.red_flags && data.red_flags.length) {
            html += `<div style="margin-top:10px; font-size:0.8rem; color: var(--accent-amber);">⚠️ ${data.red_flags.map(f => escapeHtml(f)).join(' • ')}</div>`;
        }
    }

    if (modelKey === 'mistral') {
        if (data.credibility) {
            const credMap = { HIGH: 'true', MEDIUM: 'mixed', LOW: 'false', UNKNOWN: 'neutral' };
            html += `<div style="margin-top:12px;"><span class="verdict-tag ${credMap[data.credibility] || 'neutral'}">${data.credibility} Credibility</span></div>`;
        }
        if (data.indicators && data.indicators.length) {
            html += `<ul style="margin-top:12px; padding-left:18px; color: var(--text-secondary); font-size:0.85rem;">`;
            data.indicators.forEach(i => { html += `<li style="margin-bottom:4px;">${escapeHtml(i)}</li>`; });
            html += `</ul>`;
        }
    }

    if (modelKey === 'nemotron') {
        if (data.bias_level) {
            const biasMap = { NONE: 'true', LOW: 'true', MODERATE: 'mixed', HIGH: 'false' };
            html += `<div style="margin-top:12px;"><span class="verdict-tag ${biasMap[data.bias_level] || 'neutral'}">${data.bias_level} Bias</span></div>`;
        }
        if (data.emotional_language && data.emotional_language.length) {
            html += `<div style="margin-top:10px; font-size:0.8rem; color: var(--accent-pink);">Emotional language: ${data.emotional_language.map(w => `"${escapeHtml(w)}"`).join(', ')}</div>`;
        }
        if (data.suggestion) {
            html += `<div style="margin-top:10px; font-size:0.8rem; color: var(--accent-cyan);">💡 ${escapeHtml(data.suggestion)}</div>`;
        }
    }

    // Confidence bar
    if (data.confidence !== undefined) {
        html += `
            <div style="margin-top:16px;">
                <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:4px;">
                    <span style="color: var(--text-muted);">Confidence</span>
                    <span style="color: var(--accent-cyan); font-weight:600;">${data.confidence}%</span>
                </div>
                <div class="score-bar">
                    <div class="score-bar-fill" style="width: ${data.confidence}%"></div>
                </div>
            </div>
        `;
    }

    elements.body.innerHTML = html;
}

function renderSources(items) {
    if (!items.length) {
        sourcesBody.innerHTML = '<div class="model-placeholder">No web sources found for this claim.</div>';
        return;
    }

    let html = '';
    items.forEach((item, i) => {
        const domain = new URL(item.link).hostname;
        html += `
            <div class="source-item compact">
                <div class="source-index">${i + 1}</div>
                <div class="source-info">
                    <h5>${escapeHtml(item.title)}</h5>
                    <span class="source-url">${escapeHtml(domain)}</span>
                </div>
                <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="source-link">Visit ↗</a>
            </div>
        `;
    });

    sourcesBody.innerHTML = html;
}

// ==========================================
// Aggregation & Verdict
// ==========================================
function computeVerdict(results, sources) {
    const { llama, mistral, nemotron } = results;

    // Weighted average confidence
    let totalWeight = 0;
    let weightedScore = 0;

    if (llama && !llama.error) {
        const w = 0.45;
        weightedScore += (llama.confidence || 50) * w;
        totalWeight += w;
    }
    if (mistral && !mistral.error) {
        const w = 0.35;
        let credScore = 50;
        if (mistral.credibility === 'HIGH') credScore = 85;
        else if (mistral.credibility === 'MEDIUM') credScore = 60;
        else if (mistral.credibility === 'LOW') credScore = 25;
        weightedScore += credScore * w;
        totalWeight += w;
    }
    if (nemotron && !nemotron.error) {
        const w = 0.20;
        let biasScore = 50;
        if (nemotron.bias_level === 'NONE') biasScore = 90;
        else if (nemotron.bias_level === 'LOW') biasScore = 75;
        else if (nemotron.bias_level === 'MODERATE') biasScore = 45;
        else if (nemotron.bias_level === 'HIGH') biasScore = 15;
        weightedScore += biasScore * w;
        totalWeight += w;
    }

    // Source bonus
    if (sources && sources.length > 0) {
        weightedScore += Math.min(sources.length * 2, 8);
    }

    let trustScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 50;
    trustScore = Math.max(0, Math.min(100, trustScore));

    // Determine verdict
    let label, summary, tags = [];

    if (llama && llama.verdict) {
        tags.push({ text: llama.verdict, cls: llama.verdict === 'TRUE' ? 'true' : llama.verdict === 'FALSE' ? 'false' : 'mixed' });
    }
    if (mistral && mistral.credibility) {
        tags.push({ text: `${mistral.credibility} Credibility`, cls: mistral.credibility === 'HIGH' ? 'true' : mistral.credibility === 'LOW' ? 'false' : 'mixed' });
    }
    if (nemotron && nemotron.bias_level) {
        const biasLabels = { NONE: 'No Bias Detected', LOW: 'Low Bias', MODERATE: 'Moderate Bias', HIGH: 'High Bias' };
        tags.push({ text: biasLabels[nemotron.bias_level] || nemotron.bias_level, cls: nemotron.bias_level === 'NONE' || nemotron.bias_level === 'LOW' ? 'true' : nemotron.bias_level === 'HIGH' ? 'false' : 'mixed' });
    }
    if (sources && sources.length > 0) {
        tags.push({ text: `${sources.length} Sources Found`, cls: 'neutral' });
    }

    if (trustScore >= 75) {
        label = '✅ Likely Trustworthy';
        summary = 'Multiple AI models and web sources suggest this claim has a strong basis in fact.';
    } else if (trustScore >= 50) {
        label = '⚠️ Needs Further Verification';
        summary = 'The evidence is mixed. We recommend checking official sources before sharing.';
    } else if (trustScore >= 25) {
        label = '🟠 Questionable';
        summary = 'Significant concerns detected. Multiple indicators suggest this claim may be misleading.';
    } else {
        label = '🔴 Likely False or Misleading';
        summary = 'AI analysis strongly suggests this claim is false or highly misleading.';
    }

    return { trustScore, label, summary, tags };
}

function renderVerdict(verdict) {
    // Animate gauge
    const circumference = 2 * Math.PI * 85;
    const offset = circumference - (verdict.trustScore / 100) * circumference;

    // Add SVG gradient definition if not present
    const gaugeSvg = document.querySelector('.gauge-svg');
    if (!gaugeSvg.querySelector('#gaugeGradient')) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#00d4ff"/>
                <stop offset="100%" stop-color="#7c3aed"/>
            </linearGradient>
        `;
        gaugeSvg.prepend(defs);
    }

    // Animate the score number
    animateNumber(gaugeNumber, 0, verdict.trustScore, 1500);

    // Animate the gauge fill
    setTimeout(() => {
        gaugeFill.style.strokeDashoffset = offset;
    }, 100);

    // Color based on score
    let gaugeColor;
    if (verdict.trustScore >= 75) gaugeColor = '#10b981';
    else if (verdict.trustScore >= 50) gaugeColor = '#f59e0b';
    else gaugeColor = '#ef4444';

    gaugeFill.style.stroke = gaugeColor;

    verdictLabel.textContent = verdict.label;
    verdictSummary.textContent = verdict.summary;

    // Render tags
    verdictTags.innerHTML = verdict.tags.map(t =>
        `<span class="verdict-tag ${t.cls}">${t.text}</span>`
    ).join('');
}

function animateNumber(el, start, end, duration) {
    const startTime = performance.now();
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
        const current = Math.round(start + (end - start) * eased);
        el.textContent = current;
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

// ==========================================
// Main Verify Handler
// ==========================================
let lastReportData = null;
let currentClaimId = null;

async function handleVerify(providedClaimId = null) {
    if (!claimInput || !resultsArea || !verifyBtn) return;

    const claim = claimInput.value.trim();
    if (!claim || claim.length < 10) return;

    const cleanClaim = claim.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 50);
    currentClaimId = providedClaimId || `custom-${cleanClaim}-${Date.now()}`;

    resultsArea.classList.remove('hidden');
    resultsArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

    verifyBtn.classList.add('loading');
    verifyBtn.disabled = true;
    verdictLabel.textContent = 'Analysing...';

    // Fire all API calls in parallel - wrapped to ensure they don't block each other
    const [llamaResult, mistralResult, nemotronResult, googleResults] = await Promise.all([
        queryNvidiaModel('llama', claim).catch(() => ({ confidence: 0, error: true })),
        queryNvidiaModel('mistral', claim).catch(() => ({ confidence: 0, error: true })),
        queryNvidiaModel('nemotron', claim).catch(() => ({ confidence: 0, error: true })),
        searchGoogle(claim).catch(() => [])
    ]);

    const verdict = computeVerdict(
        { llama: llamaResult, mistral: mistralResult, nemotron: nemotronResult },
        googleResults
    );

    renderVerdict(verdict);
    verifyBtn.classList.remove('loading');
    verifyBtn.disabled = false;

    // 🔄 REFRESH HISTORY SIDEBAR IMMEDIATELY
    if (currentUser && currentUser.email) {
        setTimeout(() => fetchUserHistory(currentUser.email), 1500);
    }
}


// ==========================================
// Real-time Socket Handlers
// ==========================================
function setupSocketListeners() {
    if (!socket) return;

    socket.on('connect', () => {
        console.log('📡 Connected to VerifAI Live Stream');
    });

    socket.on('new-claim-detected', (data) => {
        console.log('📡 Real-time claim received:', data.claim);
        addLiveFeedItem(data);
    });

    socket.on('initial-claims', (claims) => {
        console.log(`📦 System Sync: Receiving ${claims.length} recent claims`);
        claims.slice().reverse().forEach(claim => addLiveFeedItem(claim));
    });
}

function addLiveFeedItem(data) {
    if (!liveFeedList) return;

    // Remove placeholder
    const placeholder = liveFeedList.querySelector('.feed-placeholder');
    if (placeholder) placeholder.remove();

    const item = document.createElement('div');
    item.className = 'live-item';
    item.innerHTML = `
        <div class="live-item-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </div>
        <div class="live-item-content">
            <h5>${escapeHtml(data.claim)}</h5>
            <div class="live-item-meta">
                <span>Breaking News</span>
                <span>•</span>
                <span>${new Date(data.timestamp).toLocaleTimeString()}</span>
            </div>
        </div>
        <button class="live-item-verify-btn" onclick="verifyFromFeed('${escapeHtml(data.claim).replace(/'/g, "\\'")}', '${data.id}')">Verify Now</button>
    `;

    function verifyFromFeed(claim, claimId) {
        claimInput.value = claim;
        charCount.textContent = claim.length;
        verifyBtn.disabled = false;
        handleVerify(claimId);
    }

    liveFeedList.prepend(item);

    // Keep only last 10 items
    if (liveFeedList.children.length > 10) {
        liveFeedList.removeChild(liveFeedList.lastChild);
    }
}

window.verifyFromFeed = verifyFromFeed; // Make available globally for onclick

// ==========================================
// 🕒 History & Persistence Handlers
// ==========================================
async function fetchHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    try {
        const response = await fetch(`${BACKEND_URL}/api/history`);
        const data = await response.json();
        renderHistory(data);
        fetchAnalytics(); // Also refresh analytics when history loads
    } catch (error) {
        console.error('Error fetching history:', error);
    }
}

async function fetchAnalytics() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/analytics`);
        const stats = await response.json();

        if (stats) {
            updateStat('statTotal', stats.totalVerifications);
            updateStat('statConfidence', (stats.averageConfidence || 0) + '%');
            updateStat('statTrue', stats.verdictCounts?.TRUE || 0);
            updateStat('statFalse', stats.verdictCounts?.FALSE || 0);
        }
    } catch (error) {
        console.error('Error fetching analytics:', error);
    }
}

function updateStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function renderHistory(items) {
    const historyList = document.getElementById('historyList');
    if (!historyList || !items.length) return;

    // Remove placeholder
    const placeholder = historyList.querySelector('.feed-placeholder');
    if (placeholder) placeholder.remove();

    historyList.innerHTML = items.map(item => `
        <div class="history-item">
            <div class="news-category-tag">${(item.category || 'NEWS').toUpperCase()}</div>
            <div class="news-title" style="flex: 1; font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(item.claim)}
            </div>
            <div class="news-meta" style="display: flex; align-items: center; gap: 15px; font-size: 0.8rem; color: var(--text-muted);">
                <span class="news-source-badge">${escapeHtml(item.source || 'General')}</span>
                <span class="news-time">${timeAgo(item.timestamp)}</span>
                <button class="live-item-verify-btn" onclick="verifyFromFeed('${escapeHtml(item.claim).replace(/'/g, "\\'")}', '${item.claim_id}')">Re-Verify</button>
            </div>
        </div>
    `).join('');
}

function timeAgo(dateString) {
    const now = new Date();
    const past = new Date(dateString);
    const ms = now - past;
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

// ==========================================
// 📄 Analyzed Report Generation (jsPDF)
// ==========================================
async function generateAnalyzedReport() {
    if (!lastReportData || !window.jspdf) {
        alert('Please verify a claim first before generating a report.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const btn = document.getElementById('createReportBtn');
    const originalText = btn.innerHTML;

    btn.innerHTML = 'Creating Report...';
    btn.disabled = true;

    try {
        const doc = new jsPDF('p', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const primaryColor = [0, 212, 255]; // Cyan
        const secondaryColor = [124, 58, 237]; // Purple

        // 1. Header & Branding
        doc.setFillColor(2, 6, 23); // Dark background
        doc.rect(0, 0, pageWidth, 40, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(28);
        doc.setTextColor(255, 255, 255);
        doc.text('Verif', 20, 25);
        doc.setTextColor(...primaryColor);
        doc.text('AI', 45, 25);

        doc.setFontSize(10);
        doc.setTextColor(150, 150, 150);
        doc.text('PROFESSIONAL VERIFICATION REPORT', pageWidth - 85, 25);

        // 2. Claim Section
        doc.setFontSize(12);
        doc.setTextColor(100, 100, 100);
        doc.text('SUBJECT CLAIM:', 20, 55);

        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        const splitClaim = doc.splitTextToSize(lastReportData.claim, pageWidth - 40);
        doc.text(splitClaim, 20, 65);

        let y = 65 + (splitClaim.length * 7);

        // 3. Verdict Card
        doc.setDrawColor(230, 230, 230);
        doc.setLineWidth(0.5);
        doc.roundedRect(20, y, pageWidth - 40, 35, 3, 3, 'S');

        doc.setFontSize(18);
        doc.setTextColor(...(lastReportData.verdict.trustScore >= 70 ? [16, 185, 129] : [239, 68, 68]));
        doc.text(lastReportData.verdict.label, 30, y + 15);

        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Trust Score: ${lastReportData.verdict.trustScore}%`, 30, y + 25);

        // "Verified" Seal
        doc.setDrawColor(...primaryColor);
        doc.setLineWidth(1);
        doc.circle(pageWidth - 45, y + 17, 12, 'S');
        doc.setFontSize(7);
        doc.setTextColor(...primaryColor);
        doc.text('VERIF AI', pageWidth - 52, y + 16);
        doc.text('CERTIFIED', pageWidth - 53, y + 20);

        y += 50;

        // 4. Model Analysis
        const models = [
            { name: 'Llama 3.1 (Fact Analysis)', data: lastReportData.models.llama },
            { name: 'Mistral (Source Credibility)', data: lastReportData.models.mistral },
            { name: 'Nemotron (Bias Detection)', data: lastReportData.models.nemotron }
        ];

        models.forEach(model => {
            if (y > 250) { doc.addPage(); y = 20; }

            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...secondaryColor);
            doc.text(model.name, 20, y);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(50, 50, 50);
            const analysis = (model.data && model.data.analysis) ? model.data.analysis : 'Analysis unavailable.';
            const splitAnalysis = doc.splitTextToSize(analysis, pageWidth - 40);
            doc.text(splitAnalysis, 20, y + 7);

            y += 15 + (splitAnalysis.length * 5);
        });

        // 5. Sources
        if (lastReportData.sources && lastReportData.sources.length > 0) {
            if (y > 230) { doc.addPage(); y = 20; }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(0, 0, 0);
            doc.text('TOP CORROBORATING SOURCES:', 20, y);
            y += 8;

            lastReportData.sources.slice(0, 3).forEach((s, i) => {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(...primaryColor);
                doc.text(`${i + 1}. ${s.title.substring(0, 80)}...`, 25, y);
                y += 5;
            });
        }

        // Footer
        const footY = doc.internal.pageSize.getHeight() - 15;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        const displayId = String(lastReportData.claim_id || 'N/A');
        doc.text(`Report ID: ${displayId.substring(0, 20)}`, 20, footY);
        doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - 70, footY);

        doc.save(`VerifAI_Analysis_Report_${Date.now()}.pdf`);
    } catch (error) {
        console.error('Report Generation Error:', error);
        alert('Failed to generate professional report.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ==========================================
// Initialize
// ==========================================
// createParticles was removed — shader.js handles the background
if (typeof createParticles === 'function') createParticles();

// Check for pending claim from updates.html
window.addEventListener('load', () => {
    fetchHistory();
    fetchAnalytics();
    if (claimInput && localStorage.getItem('pendingClaim')) {
        const claim = localStorage.getItem('pendingClaim');
        localStorage.removeItem('pendingClaim');
        claimInput.value = claim;
        if (typeof verifyClaim === 'function') verifyClaim(claim);
        else handleVerify();
    }

    checkServerStatus();
    setInterval(checkServerStatus, 5000);
});

// Server Health Heartbeat
async function checkServerStatus() {
    const statusEl = document.getElementById('serverStatus');
    if (!statusEl) return;

    try {
        const res = await fetch(`${BACKEND_URL}/api/health`);
        if (res.ok) {
            statusEl.textContent = 'Server: Online';
            statusEl.classList.add('online');
            statusEl.classList.remove('offline');
        } else {
            throw new Error();
        }
    } catch (e) {
        statusEl.textContent = 'Server: Offline';
        statusEl.classList.add('offline');
        statusEl.classList.remove('online');
    }
}

console.log('%c✅ VerifAI loaded — 3 AI models ready', 'color: #00d4ff; font-weight: bold; font-size: 14px;');
