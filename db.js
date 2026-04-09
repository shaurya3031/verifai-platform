const admin = require('firebase-admin');
const path = require('path');

let db;

// Initialize Firebase Admin (supports both local file and cloud env var)
try {
    let credential;
    
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // Cloud deployment: credentials come from environment variable (JSON string)
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        credential = admin.credential.cert(serviceAccount);
        console.log('🔥 Firebase Admin initialized via environment variable');
    } else {
        // Local development: credentials from file
        const serviceAccountPath = path.resolve(__dirname, 'serviceAccountKey.json');
        credential = admin.credential.cert(serviceAccountPath);
        console.log('🔥 Firebase Admin initialized via local serviceAccountKey.json');
    }

    if (!admin.apps.length) {
        admin.initializeApp({ credential });
    }
    db = admin.firestore();
} catch (err) {
    console.error('❌ Firebase Admin initialization error:', err.message);
    console.warn('⚠️  Server will run without Cloud DB persistence.');
}

// Safe guard — returns true if Firestore is available
const isDbReady = () => !!db;

/**
 * Initialize Database (Firestore version)
 * In Firestore, we don't need to manually create tables/schemas,
 * but we can ensure the collections exist or log readiness.
 */
const initDatabase = async () => {
    if (!isDbReady()) {
        console.warn('⚠️  Firestore not initialized. Add FIREBASE_SERVICE_ACCOUNT env var.');
        return;
    }
    console.log('✅ Firestore (Cloud DB) is ready for operations');
    return Promise.resolve();
};

module.exports = {
    initDatabase,

    // Save or update news item
    saveNewsItem: async (item) => {
        if (!isDbReady()) return null;
        try {
            await db.collection('news').doc(item.id).set({
                ...item,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return item.id;
        } catch (err) {
            console.error('Firestore saveNewsItem error:', err.message);
            return null; // Don't crash — just skip saving
        }
    },

    // Get latest news
    getLatestNews: async (maxCount = 20) => {
        if (!isDbReady()) return [];
        try {
            const snapshot = await db.collection('news')
                .orderBy('timestamp', 'desc')
                .limit(maxCount)
                .get();
            return snapshot.docs.map(doc => doc.data());
        } catch (err) {
            console.error('Firestore getLatestNews error:', err.message);
            return [];
        }
    },

    // Save verification to cache (with user mapping)
    saveVerification: async (v) => {
        if (!isDbReady()) return false;
        try {
            await db.collection('verifications').add({
                ...v,
                date: new Date().toISOString(),
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (err) {
            console.error('Firestore saveVerification error:', err.message);
            return false;
        }
    },

    // Get latest verifications for a specific user
    getUserHistory: async (user_email, maxCount = 20) => {
        if (!isDbReady()) return [];
        try {
            const snapshot = await db.collection('verifications')
                .where('user_email', '==', user_email)
                .limit(maxCount)
                .get();
            
            const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Sort in memory to avoid index requirement
            return results.sort((a, b) => {
                const tA = a.createdAt ? a.createdAt.toDate().getTime() : 0;
                const tB = b.createdAt ? b.createdAt.toDate().getTime() : 0;
                return tB - tA;
            });
        } catch (err) {
            console.error('Firestore getUserHistory error:', err.message);
            return [];
        }
    },

    // Get latest verifications across ALL users (Global Stream)
    getGlobalHistory: async (maxCount = 20) => {
        if (!isDbReady()) return [];
        try {
            const snapshot = await db.collection('verifications')
                .limit(maxCount)
                .get();
            
            const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Sort in memory to avoid index requirement
            return results.sort((a, b) => {
                const tA = a.createdAt ? a.createdAt.toDate().getTime() : 0;
                const tB = b.createdAt ? b.createdAt.toDate().getTime() : 0;
                return tB - tA;
            });
        } catch (err) {
            console.error('Firestore getGlobalHistory error:', err.message);
            return [];
        }
    },

    // Get verification from cache (for global deduplication)
    getVerification: async (claim_id, model) => {
        if (!isDbReady()) return null;
        try {
            const snapshot = await db.collection('verifications')
                .where('claim_id', '==', claim_id)
                .where('model', '==', model)
                .limit(1)
                .get();
            if (snapshot.empty) return null;
            return snapshot.docs[0].data();
        } catch (err) {
            console.error('Firestore getVerification error:', err.message);
            return null;
        }
    },

    // Aggregated Analytics
    getAnalytics: async () => {
        if (!isDbReady()) return { totalVerifications: 0, modelCounts: {}, verdictCounts: { TRUE: 0, FALSE: 0, MIXED: 0, OTHER: 0 }, averageConfidence: 0 };
        try {
            const snapshot = await db.collection('verifications').get();
            const rows = snapshot.docs.map(doc => doc.data());

            let stats = {
                totalVerifications: rows.length,
                modelCounts: {},
                verdictCounts: { TRUE: 0, FALSE: 0, MIXED: 0, OTHER: 0 },
                averageConfidence: 0
            };

            let totalConfidence = 0;
            rows.forEach(row => {
                // Model count
                stats.modelCounts[row.model] = (stats.modelCounts[row.model] || 0) + 1;
                // Verdict count
                const v = (row.verdict || 'OTHER').toUpperCase();
                if (stats.verdictCounts[v] !== undefined) stats.verdictCounts[v]++;
                else stats.verdictCounts.OTHER++;
                // Confidence
                totalConfidence += (row.confidence || 0);
            });

            if (stats.totalVerifications > 0) {
                stats.averageConfidence = Math.round(totalConfidence / stats.totalVerifications);
            }
            return stats;
        } catch (err) {
            console.error('Firestore getAnalytics error:', err.message);
            throw err;
        }
    },

    // Configuration Management
    saveConfig: async (key, value) => {
        if (!isDbReady()) return false;
        try {
            await db.collection('config').doc(key).set({
                value: JSON.stringify(value),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (err) {
            console.error('Firestore saveConfig error:', err.message);
            throw err;
        }
    },

    getConfig: async (key) => {
        if (!isDbReady()) return null;
        try {
            const doc = await db.collection('config').doc(key).get();
            if (!doc.exists) return null;
            return JSON.parse(doc.data().value);
        } catch (err) {
            console.error('Firestore getConfig error:', err.message);
            throw err;
        }
    }
};
