/**
 * Rent-a-mec production server
 * - SQLite (node:sqlite)
 * - Stripe Checkout (REST)
 * - HTTPS (self-signed local certs)
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Load .env manually (no dotenv dependency)
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
})();

const db = require('./db');
const { getQuote, MAX_HOURS } = require('./pricing');
const { register, login, authFromRequest, uuid } = require('./auth');
const stripe = require('./stripe');

const PORT = Number(process.env.PORT) || 3847;
const PUBLIC = path.join(__dirname, '..', 'public');
const CERT_DIR = path.join(__dirname, '..', 'certs');
const USE_HTTPS = process.env.HTTPS !== '0' && fs.existsSync(path.join(CERT_DIR, 'key.pem'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': headers['Content-Type'] || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function requireAuth(req, res, roles) {
  const user = authFromRequest(req);
  if (!user) {
    send(res, 401, { error: 'Authentication required' });
    return null;
  }
  if (roles && roles.length && !roles.includes(user.role)) {
    send(res, 403, { error: 'Insufficient permissions' });
    return null;
  }
  return user;
}

async function handleApi(req, res, pathname, url) {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (pathname === '/api/health' && req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      service: 'rent-a-mec',
      time: new Date().toISOString(),
      db: 'sqlite',
      https: USE_HTTPS,
      stripe: stripe.getConfig(),
    });
  }

  if (pathname === '/api/pricing/quote' && req.method === 'GET') {
    return send(res, 200, getQuote(url.searchParams.get('hours')));
  }

  if (pathname === '/api/config' && req.method === 'GET') {
    return send(res, 200, {
      stripe: stripe.getConfig(),
      https: USE_HTTPS,
    });
  }

  if (pathname === '/api/mechanics' && req.method === 'GET') {
    const list = db.listMechanics({
      area: url.searchParams.get('area'),
      specialty: url.searchParams.get('specialty'),
    });
    return send(res, 200, list);
  }

  const mechMatch = pathname.match(/^\/api\/mechanics\/([^/]+)$/);
  if (mechMatch && req.method === 'GET') {
    const m = db.findMechanicById(mechMatch[1]);
    if (!m || !m.active) return send(res, 404, { error: 'Mechanic not found' });
    return send(res, 200, m);
  }

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      if (!body.email || !body.password || !body.name) {
        return send(res, 400, { error: 'email, password, and name are required' });
      }
      if (body.password.length < 6) {
        return send(res, 400, { error: 'Password must be at least 6 characters' });
      }
      return send(res, 201, register(body));
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      if (!body.email || !body.password) {
        return send(res, 400, { error: 'email and password are required' });
      }
      return send(res, 200, login(body));
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const full = db.findUserById(user.id);
    if (!full) return send(res, 404, { error: 'User not found' });
    const { passwordHash, ...safe } = full;
    return send(res, 200, safe);
  }

  if (pathname === '/api/bookings' && req.method === 'POST') {
    const user = requireAuth(req, res, ['buyer', 'admin']);
    if (!user) return;
    try {
      const body = await readBody(req);
      if (!body.date || !body.time || !body.zip || !body.vehicle) {
        return send(res, 400, { error: 'date, time, zip, and vehicle are required' });
      }
      const quote = getQuote(body.hours);
      let mechanic = null;
      if (body.mechanicId) {
        mechanic = db.findMechanicById(body.mechanicId);
        if (!mechanic || !mechanic.active) return send(res, 404, { error: 'Selected mechanic not found' });
      }
      const booking = {
        id: uuid(),
        buyerId: user.id,
        buyerName: user.name,
        mechanicId: mechanic ? mechanic.id : null,
        mechanicName: mechanic ? mechanic.name : null,
        status: mechanic ? 'requested' : 'open',
        hours: quote.hours,
        rate: quote.rate,
        total: quote.total,
        currency: 'USD',
        date: body.date,
        time: body.time,
        zip: String(body.zip).trim(),
        vehicle: String(body.vehicle).trim(),
        serviceType: body.serviceType || 'inspect',
        notes: body.notes || '',
        paymentStatus: 'unpaid',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.insertBooking(booking);
      return send(res, 201, booking);
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  if (pathname === '/api/bookings/mine' && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    return send(res, 200, db.listBookingsForUser(user));
  }

  // POST /api/bookings/:id/pay — create Stripe Checkout session
  const payMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/pay$/);
  if (payMatch && req.method === 'POST') {
    const user = requireAuth(req, res, ['buyer', 'admin']);
    if (!user) return;
    try {
      const booking = db.findBookingById(payMatch[1]);
      if (!booking) return send(res, 404, { error: 'Booking not found' });
      if (booking.buyerId !== user.id && user.role !== 'admin') {
        return send(res, 403, { error: 'Not your booking' });
      }
      if (booking.paymentStatus === 'paid') {
        return send(res, 400, { error: 'Already paid' });
      }
      if (['cancelled', 'completed'].includes(booking.status)) {
        return send(res, 400, { error: 'Cannot pay for ' + booking.status + ' booking' });
      }
      const session = await stripe.createCheckoutSession(booking, user);
      return send(res, 200, session);
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  }

  // GET /api/payments/confirm?session_id=
  if (pathname === '/api/payments/confirm' && req.method === 'GET') {
    try {
      const sessionId = url.searchParams.get('session_id');
      const result = await stripe.confirmSession(sessionId);
      return send(res, 200, result);
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  }

  const bookMatch = pathname.match(/^\/api\/bookings\/([^/]+)(?:\/(accept|cancel|complete))?$/);
  if (bookMatch) {
    const bookingId = bookMatch[1];
    const action = bookMatch[2];

    if (!action && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      const booking = db.findBookingById(bookingId);
      if (!booking) return send(res, 404, { error: 'Booking not found' });
      const allowed =
        booking.buyerId === user.id ||
        (user.role === 'mechanic' && (booking.mechanicId === user.mechanicId || booking.status === 'open')) ||
        user.role === 'admin';
      if (!allowed) return send(res, 403, { error: 'Not allowed' });
      return send(res, 200, booking);
    }

    if (action === 'accept' && req.method === 'POST') {
      const user = requireAuth(req, res, ['mechanic']);
      if (!user) return;
      const b = db.findBookingById(bookingId);
      if (!b) return send(res, 404, { error: 'Booking not found' });
      if (!['open', 'requested'].includes(b.status)) {
        return send(res, 400, { error: 'Cannot accept booking in status: ' + b.status });
      }
      if (b.mechanicId && b.mechanicId !== user.mechanicId) {
        return send(res, 403, { error: 'Assigned to another mechanic' });
      }
      const mech = db.findMechanicById(user.mechanicId);
      if (!mech) return send(res, 400, { error: 'Mechanic profile not linked' });
      const updated = db.updateBooking(bookingId, {
        mechanicId: mech.id,
        mechanicName: mech.name,
        status: 'confirmed',
        updatedAt: new Date().toISOString(),
      });
      return send(res, 200, updated);
    }

    if (action === 'cancel' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await readBody(req);
      const b = db.findBookingById(bookingId);
      if (!b) return send(res, 404, { error: 'Booking not found' });
      const allowed =
        b.buyerId === user.id ||
        (user.role === 'mechanic' && b.mechanicId === user.mechanicId) ||
        user.role === 'admin';
      if (!allowed) return send(res, 403, { error: 'Not allowed' });
      if (['completed', 'cancelled'].includes(b.status)) {
        return send(res, 400, { error: 'Already ' + b.status });
      }
      const updated = db.updateBooking(bookingId, {
        status: 'cancelled',
        cancelReason: body.reason || '',
        updatedAt: new Date().toISOString(),
      });
      return send(res, 200, updated);
    }

    if (action === 'complete' && req.method === 'POST') {
      const user = requireAuth(req, res, ['mechanic']);
      if (!user) return;
      const body = await readBody(req);
      const b = db.findBookingById(bookingId);
      if (!b) return send(res, 404, { error: 'Booking not found' });
      if (b.mechanicId !== user.mechanicId) return send(res, 403, { error: 'Not your booking' });
      if (b.status !== 'confirmed') return send(res, 400, { error: 'Only confirmed bookings can be completed' });
      const updated = db.updateBooking(bookingId, {
        status: 'completed',
        completionNotes: body.notes || '',
        updatedAt: new Date().toISOString(),
      });
      return send(res, 200, updated);
    }
  }

  return send(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC, 'index.html');
  }
  const ext = path.extname(filePath);
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
}

const handler = async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    if (pathname.startsWith('/api')) await handleApi(req, res, pathname, url);
    else serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Internal server error' });
  }
};

let server;
if (USE_HTTPS) {
  const opts = {
    key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')),
    cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')),
  };
  server = https.createServer(opts, handler);
} else {
  server = http.createServer(handler);
}

server.listen(PORT, () => {
  const proto = USE_HTTPS ? 'https' : 'http';
  console.log('\n  Rent-a-mec production');
  console.log('  URL:     ' + proto + '://localhost:' + PORT);
  console.log('  DB:      SQLite → ' + db.DB_PATH);
  console.log('  HTTPS:   ' + (USE_HTTPS ? 'on (self-signed)' : 'off'));
  console.log('  Stripe:  ' + (stripe.DEMO_MODE ? 'demo mode (set STRIPE_SECRET_KEY for live test)' : 'configured'));
  console.log('');
});
