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

/**
 * Initialize Database (Firestore version)
 * In Firestore, we don't need to manually create tables/schemas,
 * but we can ensure the collections exist or log readiness.
 */
const initDatabase = async () => {
    console.log('✅ Firestore (Cloud DB) is ready for operations');
    return Promise.resolve();
};

module.exports = {
    initDatabase,

    // Save or update news item
    saveNewsItem: async (item) => {
        try {
            await db.collection('news').doc(item.id).set({
                ...item,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return item.id;
        } catch (err) {
            console.error('Firestore saveNewsItem error:', err.message);
            throw err;
        }
    },

    // Get latest news
    getLatestNews: async (maxCount = 20) => {
        try {
            const snapshot = await db.collection('news')
                .orderBy('timestamp', 'desc')
                .limit(maxCount)
                .get();
            return snapshot.docs.map(doc => doc.data());
        } catch (err) {
            console.error('Firestore getLatestNews error:', err.message);
            throw err;
        }
    },

    // Save verification to cache (with user mapping)
    saveVerification: async (v) => {
        try {
            await db.collection('verifications').add({
                ...v,
                date: new Date().toISOString(),
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (err) {
            console.error('Firestore saveVerification error:', err.message);
            throw err;
        }
    },

    // Get latest verifications for a specific user
    getUserHistory: async (user_email, maxCount = 20) => {
        try {
            const snapshot = await db.collection('verifications')
                .where('user_email', '==', user_email)
                .orderBy('createdAt', 'desc')
                .limit(maxCount)
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (err) {
            console.error('Firestore getUserHistory error:', err.message);
            throw err;
        }
    },

    // Get verification from cache (for global deduplication)
    getVerification: async (claim_id, model) => {
        try {
            const snapshot = await db.collection('verifications')
                .where('claim_id', '==', claim_id)
                .where('model', '==', model)
                .orderBy('createdAt', 'desc')
                .limit(1)
                .get();
            
            if (snapshot.empty) return null;
            return snapshot.docs[0].data();
        } catch (err) {
            console.error('Firestore getVerification error:', err.message);
            throw err;
        }
    },

    // Aggregated Analytics
    getAnalytics: async () => {
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
