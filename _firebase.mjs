import admin from 'firebase-admin';
let app;
export function getDb() {
  if (!app) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
    const serviceAccount = JSON.parse(raw);
    app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}
export function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) };
}
