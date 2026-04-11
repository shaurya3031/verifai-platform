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
        window.location.replace('index.html'); // After logout, go to public landing page
    } catch (error) {
        console.error('Logout error:', error);
    }
};

// --- Auth State Redirect & Diagnostics ---
auth.onAuthStateChanged((user) => {
    const path = window.location.pathname;
    const hostname = window.location.hostname;
    
    // Robust page identification
    const isAuthPage = path.includes('auth.html');
    const isVerificationPage = path.includes('verification.html');
    const isLandingPage = path === '/' || path.endsWith('/') || path.includes('index.html');

    console.log(`[Auth Diagnostic] State Change | User: ${user ? user.email : 'None'} | Page: ${path}`);
    
    if (user) {
        if (isAuthPage) {
            console.log('🔄 User logged in on Auth Page -> Jumping to Workspace');
            window.location.href = 'verification.html';
        }
        // If on index.html, stay there (it's the official entry)
    } else {
        if (isVerificationPage) {
            console.log('🔒 Logged out on Protected Page -> Redirecting to Auth');
            window.location.href = 'auth.html';
        }
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
    submitBtn.textContent = isLoginMode ? 'Login' : 'Sign Up';
};

if (loginTab) loginTab.addEventListener('click', () => toggleMode(true));
if (signupTab) signupTab.addEventListener('click', () => toggleMode(false));

// --- Auth Functions ---
const handleAuth = async (e) => {
    e.preventDefault();
    const email = emailInput.value;
    const password = passwordInput.value;

    submitBtn.disabled = true;
    submitBtn.textContent = isLoginMode ? 'Logging In...' : 'Creating Account...';

    try {
        if (isLoginMode) {
            console.log('🔐 Attempting login for:', email);
            await auth.signInWithEmailAndPassword(email, password);
        } else {
            console.log('📝 Attempting signup for:', email);
            await auth.createUserWithEmailAndPassword(email, password);
        }
        // Trigger On-Demand News Refresh on Backend
        fetch('/api/news/refresh', { method: 'POST' }).catch(e => console.log('Refresh trigger error:', e));

        // Redirect on success → to the protected verification workspace
        window.location.href = 'verification.html';
    } catch (error) {
        console.error('Auth Error Code:', error.code);
        console.error('Auth Error Message:', error.message);

        const errorMap = {
            'auth/invalid-credential':    { msg: 'Email or password is incorrect. If you haven\'t signed up yet, switch to the Signup tab.', suggest: 'signup' },
            'auth/user-not-found':        { msg: 'No account with this email. Click Signup to create one.', suggest: 'signup' },
            'auth/wrong-password':        { msg: 'Incorrect password. Try again or use Forgot Password.', suggest: null },
            'auth/email-already-in-use':  { msg: 'Account already exists. Switch to the Login tab.', suggest: 'login' },
            'auth/weak-password':         { msg: 'Password must be at least 6 characters.', suggest: null },
            'auth/invalid-email':         { msg: 'Please enter a valid email address.', suggest: null },
            'auth/too-many-requests':     { msg: 'Too many failed attempts. Please wait a few minutes and try again.', suggest: null },
            'auth/operation-not-allowed': { msg: 'Email/Password sign-in is disabled in Firebase Console. Enable it under Authentication → Sign-in method.', suggest: null },
            'auth/network-request-failed':{ msg: 'Network error — check your internet connection.', suggest: null },
        };

        const errInfo = errorMap[error.code] || { msg: error.message, suggest: null };
        showErrorBanner(errInfo.msg);

        if (errInfo.suggest === 'signup' && isLoginMode) {
            setTimeout(() => toggleMode(false), 1500);
        } else if (errInfo.suggest === 'login' && !isLoginMode) {
            setTimeout(() => toggleMode(true), 1500);
        }

        submitBtn.disabled = false;
        submitBtn.textContent = isLoginMode ? 'Login' : 'Sign Up';
    }
};

const handleGoogleSignIn = async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    const hostname = window.location.hostname;
    
    // Check if we already tried popup and failed (to avoid loops)
    const isRedirectFallback = localStorage.getItem('google_auth_fallback') === 'true';

    try {
        console.log(`🚀 Starting Google Sign-In on ${hostname}...`);
        
        if (isRedirectFallback) {
            localStorage.removeItem('google_auth_fallback');
            await auth.signInWithRedirect(provider);
            return;
        }

        await auth.signInWithPopup(provider);
        
        // Trigger On-Demand News Refresh on Backend
        fetch('/api/news/refresh', { method: 'POST' }).catch(e => console.log('Refresh trigger error:', e));

        // Redirect to verification workspace
        window.location.href = 'verification.html';
    } catch (error) {
        console.error('Google Auth Detail Error:', error);

        if (error.code === 'auth/unauthorized-domain') {
            const domain = window.location.hostname;
            const message = `❌ ACCESS BLOCKED\n\nThe domain "${domain}" is not authorized in your Firebase/Google setup.\n\nFIX QUICKLY:\n1. Go to Firebase Console -> Authentication -> Settings -> Authorized domains.\n2. Add "${domain}" to the list.\n3. Also add it to "Authorized JavaScript origins" in Google Cloud Console.`;
            alert(message);
            showErrorBanner(`Unauthorized Domain: Please whitelist ${domain} in Firebase Console.`);
        } 
        else if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
            const tryRedirect = confirm('The login popup was blocked or closed. Switch to "Direct Redirect" mode?');
            if (tryRedirect) {
                localStorage.setItem('google_auth_fallback', 'true');
                await auth.signInWithRedirect(provider);
            }
        }
        else {
            showErrorBanner(`Google Auth Failed: ${error.message}`);
        }
    }
};

// --- Error Banner ---
const showErrorBanner = (message) => {
    let banner = document.getElementById('errorBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'errorBanner';
        banner.style.cssText = `
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.4);
            border-radius: 10px;
            padding: 12px 16px;
            margin-top: 16px;
            color: #fca5a5;
            font-size: 0.88rem;
            line-height: 1.5;
            animation: fadeInScale 0.3s ease;
        `;
        authForm.after(banner);
    }
    banner.textContent = message;
    banner.style.display = 'block';
    setTimeout(() => { if (banner) banner.style.display = 'none'; }, 6000);
};

// --- Password Reset ---
const handleForgotPassword = async () => {
    const email = emailInput.value;
    if (!email) {
        showErrorBanner('Enter your email address first, then click Forgot Password.');
        return;
    }
    try {
        await auth.sendPasswordResetEmail(email);
        showErrorBanner(`✅ Password reset email sent to ${email}. Check your inbox.`);
    } catch (error) {
        showErrorBanner('Could not send reset email: ' + (error.message || 'Unknown error'));
    }
};

// --- Listeners ---
if (authForm) authForm.addEventListener('submit', handleAuth);
if (googleBtn) googleBtn.addEventListener('click', handleGoogleSignIn);

// Add Forgot Password link dynamically
const forgotLink = document.createElement('div');
forgotLink.style.cssText = 'text-align:right; margin-top: -10px; margin-bottom: 16px;';
forgotLink.innerHTML = `<span id="forgotPasswordLink" style="font-size:0.8rem; color:var(--accent-cyan); cursor:pointer;">Forgot Password?</span>`;
const passwordGroup = passwordInput?.closest('.form-group');
if (passwordGroup) passwordGroup.after(forgotLink);
document.getElementById('forgotPasswordLink')?.addEventListener('click', handleForgotPassword);

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
