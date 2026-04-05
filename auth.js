/**
 * VerifAI — Authentication Logic
 * Handled via Firebase Client SDK
 */

// --- Firebase Configuration ---
// TO USER: Replace the following config with your own Firebase project settings
// from the Firebase Console (Project Settings > General > Your Apps)
const firebaseConfig = {
    apiKey: "AIzaSyAJeBLykRpWltJ_Y9-Xh1yFObMRfednJOU",
    authDomain: "news15-404dc.firebaseapp.com",
    databaseURL: "https://news15-404dc-default-rtdb.firebaseio.com",
    projectId: "news15-404dc",
    storageBucket: "news15-404dc.firebasestorage.app",
    messagingSenderId: "850703589821",
    appId: "1:850703589821:web:82ff3577f8187e5778b2d4",
    measurementId: "G-3RP0L0RNDQ"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();

// Global Logout Handler (Defined early for inline HTML access)
window.handleLogout = async () => {
    try {
        console.log('🚪 Signing out...');
        await auth.signOut();
        window.location.replace('auth.html'); // Clear history stack for login security
    } catch (error) {
        console.error('Logout error:', error);
    }
};

// --- Auth State Redirect ---
// Ensure user is logged in for protected pages, and redirect if they are not.
auth.onAuthStateChanged((user) => {
    const isAuthPage = window.location.pathname.endsWith('auth.html');
    if (user && isAuthPage) {
        window.location.href = 'index.html';
    } else if (!user && !isAuthPage) {
        window.location.href = 'auth.html';
    }
});

// --- DOM Elements ---
const authForm = document.getElementById('authForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const submitBtn = document.getElementById('submitBtn');
const googleBtn = document.getElementById('googleBtn');
const loginTab = document.getElementById('loginTab');
const signupTab = document.getElementById('signupTab');
const authTitle = document.getElementById('authTitle');
const authSubtitle = document.getElementById('authSubtitle');

let isLoginMode = true;

// --- UI Toggles ---
const toggleMode = (login) => {
    isLoginMode = login;
    loginTab.classList.toggle('active', isLoginMode);
    signupTab.classList.toggle('active', !isLoginMode);
    
    authTitle.textContent = isLoginMode ? 'Welcome Back' : 'Create Account';
    authSubtitle.textContent = isLoginMode 
        ? 'Sign in to continue verifying the truth.' 
        : 'Join VerifAI to start fact-checking with precision.';
    submitBtn.textContent = isLoginMode ? 'Sign In' : 'Sign Up';
};

loginTab.addEventListener('click', () => toggleMode(true));
signupTab.addEventListener('click', () => toggleMode(false));

// --- Auth Functions ---
const handleAuth = async (e) => {
    e.preventDefault();
    const email = emailInput.value;
    const password = passwordInput.value;

    submitBtn.disabled = true;
    submitBtn.textContent = isLoginMode ? 'Signing In...' : 'Creating Account...';

    try {
        if (isLoginMode) {
            await auth.signInWithEmailAndPassword(email, password);
        } else {
            await auth.createUserWithEmailAndPassword(email, password);
        }
        // Trigger On-Demand News Refresh on Backend
        fetch('/api/news/refresh', { method: 'POST' }).catch(e => console.log('Refresh trigger error:', e));

        // Redirect on success
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Auth Error:', error.message);
        alert(`Authentication Failed: ${error.message}`);
        submitBtn.disabled = false;
        submitBtn.textContent = isLoginMode ? 'Sign In' : 'Sign Up';
    }
};

const handleGoogleSignIn = async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        await auth.signInWithPopup(provider);
        
        // Trigger On-Demand News Refresh on Backend
        fetch('/api/news/refresh', { method: 'POST' }).catch(e => console.log('Refresh trigger error:', e));

        window.location.href = 'index.html';
    } catch (error) {
        console.error('Google Sign-In Error:', error.message);
        alert(`Google Sign-In Failed: ${error.message}`);
    }
};

// --- Listeners ---
if (authForm) authForm.addEventListener('submit', handleAuth);
if (googleBtn) googleBtn.addEventListener('click', handleGoogleSignIn);

// Logout functions are already handled at the top of the file

// --- Magnetic Effects ---
const initMagnetic = () => {
    const magneticEls = document.querySelectorAll('.magnetic');
    magneticEls.forEach(el => {
        el.addEventListener('mousemove', function(e) {
            const rect = this.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            this.style.transform = `translate(${x * 0.2}px, ${y * 0.3}px)`;
        });
        el.addEventListener('mouseleave', function() {
            this.style.transform = 'translate(0, 0)';
        });
    });
};

document.addEventListener('DOMContentLoaded', initMagnetic);
