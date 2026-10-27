import { getDb, json } from './_firebase.mjs';
export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { ResultCode: 1, ResultDesc: 'POST only' });
  try {
    const body = JSON.parse(event.body || '{}');
    const cb = body?.Body?.stkCallback;
    if (!cb?.CheckoutRequestID) return json(400, { ResultCode: 1, ResultDesc: 'Invalid callback' });
    const db = getDb();
    const q = await db.collection('orders').where('checkoutRequestId', '==', cb.CheckoutRequestID).limit(1).get();
    if (q.empty) {
      console.warn('No order found for callback', cb.CheckoutRequestID);
      return json(200, { ResultCode: 0, ResultDesc: 'Callback received' });
    }
    const order = q.docs[0];
    if (Number(cb.ResultCode) === 0) {
      const meta = cb.CallbackMetadata?.Item || [];
      const find = name => meta.find(x => x.Name === name)?.Value;
      await order.ref.update({ paymentStatus: 'paid', status: 'paid', mpesaReceiptNumber: String(find('MpesaReceiptNumber') || ''), paidAmount: Number(find('Amount') || 0), paidPhone: String(find('PhoneNumber') || ''), transactionDate: String(find('TransactionDate') || ''), paymentVerifiedAt: new Date().toISOString() });
    } else {
      await order.ref.update({ paymentStatus: 'failed', status: 'payment_failed', paymentResultCode: Number(cb.ResultCode), paymentResultDescription: String(cb.ResultDesc || 'Payment failed').slice(0,250) });
    }
    return json(200, { ResultCode: 0, ResultDesc: 'Callback processed' });
  } catch (e) {
    console.error('callback processing error', e.message);
    return json(500, { ResultCode: 1, ResultDesc: 'Callback processing error' });
  }
}
