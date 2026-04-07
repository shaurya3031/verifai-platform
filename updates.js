/* ============================================
   VerifAI — Live News Dashboard Logic
   ============================================ */

const newsGrid = document.getElementById('newsGrid');
const seeMoreBtn = document.getElementById('seeMoreBtn');
const categoryTabs = document.getElementById('categoryTabs');

let currentCategory = 'world';
let currentPage = 1;
let isLoading = false;

// Proxy API endpoints (detects if running on Live Server or direct)
const getBackendUrl = () => {
    // If we're on a standard cloud port (none) or already on 3000, use relative paths
    if (window.location.port === '3000' || !window.location.port) return '';
    
    // Fallback: Check if we are on localhost/127.0.0.1 and target 3000
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
        return `${window.location.protocol}//127.0.0.1:3000`;
    }
    
    // Otherwise, target the current hostname on 3000 (standard for some setups)
    return `${window.location.protocol}//${window.location.hostname}:3000`;
};

const BACKEND_URL = getBackendUrl();
console.log('📡 VerifAI Backend Target:', BACKEND_URL || '(Relative)');

// Initialize
async function init() {
    loadNews(currentCategory, 1);
    checkServerStatus();
    
    // Auto-refresh every 60 seconds
    setInterval(() => {
        if (!isLoading && currentPage === 1) {
            loadNews(currentCategory, 1, true);
        }
    }, 60000);

    // Navbar Initialization (Shared with index.html)
    initNavbar();

    // Heartbeat every 5 seconds
    setInterval(checkServerStatus, 5000);
}

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

// Category Tab Switching
categoryTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.category-tab');
    if (!tab || tab.classList.contains('active')) return;

    // UI Update
    document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Data Update
    currentCategory = tab.dataset.category;
    currentPage = 1;
    newsGrid.innerHTML = '';
    loadNews(currentCategory, 1);
});

// See More
seeMoreBtn.addEventListener('click', () => {
    if (isLoading) return;
    currentPage++;
    loadNews(currentCategory, currentPage);
});

async function loadNews(category, page, isAutoRefresh = false) {
    if (isLoading) return;
    isLoading = true;

    if (!isAutoRefresh) {
        seeMoreBtn.disabled = true;
        seeMoreBtn.textContent = 'Loading...';
        if (page === 1) {
            newsGrid.innerHTML = Array(6).fill(0).map(() => createShimmerCard()).join('');
        }
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/news?category=${category}&page=${page}`);
        const data = await response.json();

        if (page === 1) newsGrid.innerHTML = '';

        if (data.items && data.items.length > 0) {
            renderNewsItems(data.items);
            seeMoreBtn.style.display = data.hasMore ? 'block' : 'none';
        } else if (page === 1) {
            newsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px;">No news found for this category.</div>';
        }

    } catch (error) {
        console.error('❌ Error loading news:', error);
        if (page === 1) {
            const errorMsg = error.message.includes('Failed to fetch') 
                ? 'Network Error: Cannot reach the backend server (Check if node server.js is running)' 
                : `Error: ${error.message}`;
            newsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--accent-red);">${errorMsg}</div>`;
        }
    } finally {
        isLoading = false;
        seeMoreBtn.disabled = false;
        seeMoreBtn.textContent = 'See More Headlines';
    }
}

function renderNewsItems(items) {
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'news-card';
        const cleanDescription = stripHtml(item.description);
        card.innerHTML = `
            <div class="news-category-tag">${currentCategory.toUpperCase()}</div>
            <div class="news-title">${escapeHtml(item.title)}</div>
            <div class="news-meta">
                <span class="news-source-badge">${escapeHtml(item.source || 'General')}</span>
                <span class="news-time">${timeAgo(item.timestamp)}</span>
                <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="news-source-link">Source ↗</a>
                <button class="news-verify-btn" onclick="verifyNews('${escapeHtml(item.title).replace(/'/g, "\\'")}')">Verify Now</button>
            </div>
        `;
        newsGrid.appendChild(card);
    });
}

function createShimmerCard() {
    return `
        <div class="news-card shimmer" style="height: 250px; opacity: 0.5;"></div>
    `;
}

function verifyNews(title) {
    // Redirect to verification workspace with claim in URL
    window.location.href = `verification.html?claim=${encodeURIComponent(title)}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
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

// Global expose
window.verifyNews = verifyNews;

function initNavbar() {
    firebase.auth().onAuthStateChanged((user) => {
        const userProfile = document.getElementById('userProfile');
        const userEmailDisplay = document.getElementById('userEmailDisplay');
        const logoutBtn = document.getElementById('logoutBtn');

        if (user) {
            if (userProfile) userProfile.style.display = 'flex';
            if (userEmailDisplay) userEmailDisplay.textContent = user.email;
            if (logoutBtn) { /* Handled via inline HTML for max reliability */ }
        }
    });

    // Server Health Heartbeat
    checkServerStatus();
    setInterval(checkServerStatus, 5000);
}

init();
