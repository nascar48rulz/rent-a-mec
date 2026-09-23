/**
 * Stripe integration via REST API (no SDK dependency).
 * Uses Checkout Sessions for booking deposits/payment.
 *
 * Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY in .env (test mode keys).
 * When keys are missing, falls back to demo mode (instant "paid" without Stripe).
 */
const crypto = require('crypto');
const db = require('./db');
const { uuid } = require('./auth');

const SECRET = process.env.STRIPE_SECRET_KEY || '';
const PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY || '';
const APP_URL = process.env.APP_URL || 'https://localhost:3847';
const DEMO_MODE = !SECRET || !SECRET.startsWith('sk_');

async function stripeRequest(method, path, body) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + SECRET,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data.error && data.error.message) || 'Stripe error';
    const err = new Error(msg);
    err.status = res.status;
    err.stripe = data.error;
    throw err;
  }
  return data;
}

/**
 * Create a Checkout Session for a booking (full amount in cents).
 * Returns { url, sessionId, demo } — client redirects to url.
 */
async function createCheckoutSession(booking, user) {
  const amountCents = Math.round(Number(booking.total) * 100);
  if (amountCents < 50) {
    const err = new Error('Amount too small for Stripe');
    err.status = 400;
    throw err;
  }

  if (DEMO_MODE) {
    // Instant success path for local demo without Stripe keys
    const sessionId = 'demo_cs_' + crypto.randomBytes(12).toString('hex');
    const paymentId = uuid();
    db.insertPayment({
      id: paymentId,
      bookingId: booking.id,
      amountCents,
      currency: 'usd',
      status: 'succeeded',
      stripeSessionId: sessionId,
      stripePaymentIntent: 'demo_pi_' + crypto.randomBytes(8).toString('hex'),
      createdAt: new Date().toISOString(),
    });
    db.updateBooking(booking.id, {
      paymentStatus: 'paid',
      stripeSessionId: sessionId,
      stripePaymentIntent: 'demo_pi',
      updatedAt: new Date().toISOString(),
    });
    return {
      demo: true,
      sessionId,
      url: APP_URL + '/?payment=success&booking=' + booking.id + '&session_id=' + sessionId,
      publishableKey: null,
    };
  }

  const session = await stripeRequest('POST', '/checkout/sessions', {
    'mode': 'payment',
    'success_url': APP_URL + '/?payment=success&booking=' + booking.id + '&session_id={CHECKOUT_SESSION_ID}',
    'cancel_url': APP_URL + '/?payment=cancelled&booking=' + booking.id,
    'client_reference_id': booking.id,
    'customer_email': user.email,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(amountCents),
    'line_items[0][price_data][product_data][name]': 'Rent-a-mec · ' + booking.hours + 'h inspection',
    'line_items[0][price_data][product_data][description]': booking.vehicle + ' · ' + booking.date + ' ' + booking.time,
    'line_items[0][quantity]': '1',
    'metadata[booking_id]': booking.id,
    'metadata[buyer_id]': user.id,
  });

  const paymentId = uuid();
  db.insertPayment({
    id: paymentId,
    bookingId: booking.id,
    amountCents,
    currency: 'usd',
    status: 'pending',
    stripeSessionId: session.id,
    stripePaymentIntent: session.payment_intent || null,
    createdAt: new Date().toISOString(),
  });
  db.updateBooking(booking.id, {
    paymentStatus: 'pending',
    stripeSessionId: session.id,
    updatedAt: new Date().toISOString(),
  });

  return {
    demo: false,
    sessionId: session.id,
    url: session.url,
    publishableKey: PUBLISHABLE || null,
  };
}

/**
 * Confirm payment after redirect (retrieve session from Stripe or demo).
 */
async function confirmSession(sessionId) {
  if (!sessionId) {
    const err = new Error('session_id required');
    err.status = 400;
    throw err;
  }

  if (sessionId.startsWith('demo_cs_') || DEMO_MODE) {
    const payment = db.findPaymentBySession(sessionId);
    if (payment) {
      const booking = db.findBookingById(payment.bookingId);
      return { paid: true, demo: true, booking, payment };
    }
    return { paid: false, demo: true };
  }

  const session = await stripeRequest('GET', '/checkout/sessions/' + encodeURIComponent(sessionId));
  const paid = session.payment_status === 'paid';
  const bookingId = session.client_reference_id || (session.metadata && session.metadata.booking_id);
  const payment = db.findPaymentBySession(sessionId);

  if (paid && payment) {
    db.updatePaymentStatus(payment.id, 'succeeded', session.payment_intent);
    if (bookingId) {
      db.updateBooking(bookingId, {
        paymentStatus: 'paid',
        stripePaymentIntent: session.payment_intent || null,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  const booking = bookingId ? db.findBookingById(bookingId) : null;
  return { paid, demo: false, booking, session, payment };
}

function getConfig() {
  return {
    demoMode: DEMO_MODE,
    publishableKey: PUBLISHABLE || null,
    configured: !DEMO_MODE,
  };
}

module.exports = {
  createCheckoutSession,
  confirmSession,
  getConfig,
  DEMO_MODE,
};
