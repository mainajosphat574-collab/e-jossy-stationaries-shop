import { getDb, json } from './_firebase.mjs';
const digits = s => String(s || '').replace(/\D/g, '');
function normalizePhone(raw) {
  let p = digits(raw);
  if (p.startsWith('0') && p.length === 10) p = '254' + p.slice(1);
  if (p.startsWith('254') && p.length === 12 && /^254[17]\d{8}$/.test(p)) return p;
  throw new Error('Enter a valid Kenyan mobile number, e.g. 0712345678 or 0111234567.');
}
async function darajaToken() {
  const key = process.env.DARAJA_CONSUMER_KEY, secret = process.env.DARAJA_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('Daraja credentials are not configured in Netlify.');
  const r = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', { headers: { Authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') } });
  const data = await r.json(); if (!r.ok || !data.access_token) throw new Error('Daraja authentication failed. Check sandbox credentials and enabled API product.');
  return data.access_token;
}
export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  try {
    const body = JSON.parse(event.body || '{}');
    const customerName = String(body.customerName || '').trim().slice(0,100);
    const deliveryAddress = String(body.deliveryAddress || '').trim().slice(0,250);
    const phone = normalizePhone(body.phone);
    if (customerName.length < 2 || deliveryAddress.length < 4) return json(400, { error: 'Enter your name and full delivery address.' });
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) return json(400, { error: 'Cart is empty or invalid.' });
    const db = getDb();
    let subtotal = 0; const items = [];
    for (const row of body.items) {
      const id = String(row.id || ''); const quantity = Number(row.quantity);
      if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return json(400, { error: 'Invalid cart item.' });
      const snap = await db.collection('publicProducts').doc(id).get();
      if (!snap.exists) return json(400, { error: 'A product is no longer available. Refresh the catalogue.' });
      const p = snap.data(); const price = Number(p.price);
      if (!Number.isFinite(price) || price <= 0) return json(400, { error: 'A product has an invalid price.' });
      subtotal += price * quantity;
      items.push({ productId: id, name: String(p.name || 'Product').slice(0,120), unitPrice: price, quantity, lineTotal: price * quantity });
    }
    const amount = Math.round(subtotal);
    if (amount < 1 || amount > 250000) return json(400, { error: 'Order total is outside the allowed test amount.' });
    const orderRef = db.collection('orders').doc();
    await orderRef.set({ customerName, phone, deliveryAddress, items, subtotal: amount, currency: 'KES', status: 'payment_pending', paymentStatus: 'unpaid', source: 'customer_shop', createdAt: new Date().toISOString(), paymentProvider: 'daraja_sandbox' });
    const shortcode = process.env.DARAJA_SHORTCODE || '174379';
    const passkey = process.env.DARAJA_PASSKEY;
    if (!passkey) throw new Error('Missing DARAJA_PASSKEY in Netlify environment variables.');
    const timestamp = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');
    const token = await darajaToken();
    const origin = event.headers.origin || process.env.URL;
    if (!origin || !/^https:\/\//.test(origin)) throw new Error('Public HTTPS site URL is unavailable.');
    const payload = { BusinessShortCode: shortcode, Password: password, Timestamp: timestamp, TransactionType: 'CustomerPayBillOnline', Amount: amount, PartyA: phone, PartyB: shortcode, PhoneNumber: phone, CallBackURL: `${origin.replace(/\/$/, '')}/.netlify/functions/mpesa-callback`, AccountReference: `JOSSY${orderRef.id.slice(0,6)}`.slice(0,12), TransactionDesc: 'Stationery order' };
    const response = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok || result.ResponseCode !== '0') {
      await orderRef.update({ status: 'payment_request_failed', paymentError: String(result.errorMessage || result.ResponseDescription || 'Daraja rejected request').slice(0,250) });
      return json(502, { error: result.errorMessage || result.ResponseDescription || 'Daraja rejected the request.' });
    }
    await orderRef.update({ merchantRequestId: result.MerchantRequestID || null, checkoutRequestId: result.CheckoutRequestID || null });
    return json(200, { message: 'STK Push request sent. Check your phone for the sandbox prompt.', orderId: orderRef.id, checkoutRequestId: result.CheckoutRequestID || null });
  } catch (e) {
    console.error('start-payment error', e.message);
    return json(400, { error: e.message || 'Could not start payment.' });
  }
}
