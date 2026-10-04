/**
 * Heart of Worship — verifyPasscode Cloud Function
 *
 * POST { passcode: string }
 * → 200 { customToken }           success
 * → 403 { error, attemptsRemaining }  wrong passcode
 * → 429 { error, waitSeconds }        locked out
 * → 500 { error }                     server error
 */
const { onRequest } = require('firebase-functions/v2/https');
const admin  = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

const META_DOC     = db.collection('_meta').doc('passcodeAttempts');
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000; // 15 min
const SESSION_MINS = 60;

exports.verifyPasscode = onRequest(
  { cors: true, secrets: ['PASSCODE_SECRET'] },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { passcode } = req.body || {};
    if (!passcode) return res.status(400).json({ error: 'passcode required' });

    const secret = process.env.PASSCODE_SECRET;
    if (!secret) return res.status(500).json({ error: 'Server misconfigured' });

    try {
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(META_DOC);
        const data = snap.exists ? snap.data() : { count: 0, lockedUntil: null };
        const now  = Date.now();

        if (data.lockedUntil) {
          const ms = data.lockedUntil.toMillis ? data.lockedUntil.toMillis() : data.lockedUntil;
          if (ms > now) return { locked: true, waitSeconds: Math.ceil((ms - now) / 1000) };
          data.count = 0; data.lockedUntil = null;
        }

        const sb = Buffer.from(secret);
        const pb = Buffer.from(passcode);
        const ok = sb.length === pb.length && crypto.timingSafeEqual(sb, pb);

        if (!ok) {
          data.count++;
          if (data.count >= MAX_ATTEMPTS) data.lockedUntil = admin.firestore.Timestamp.fromMillis(now + LOCKOUT_MS);
          tx.set(META_DOC, { ...data, lastAttempt: admin.firestore.Timestamp.now() });
          return { wrong: true, attemptsRemaining: Math.max(0, MAX_ATTEMPTS - data.count), lockedOut: data.count >= MAX_ATTEMPTS };
        }

        tx.set(META_DOC, { count: 0, lockedUntil: null, lastAttempt: admin.firestore.Timestamp.now() });
        return { correct: true };
      });

      if (result.locked) return res.status(429).json({ error: 'Too many attempts', waitSeconds: result.waitSeconds });
      if (result.wrong)  return res.status(403).json({ error: 'Incorrect passcode', attemptsRemaining: result.attemptsRemaining, lockedUntil: result.lockedOut });

      const token = await admin.auth().createCustomToken('editor-session', { editor: true, exp: Math.floor(Date.now() / 1000) + SESSION_MINS * 60 });
      return res.status(200).json({ customToken: token });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);
