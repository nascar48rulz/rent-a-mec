/**
 * SQLite database layer using Node built-in node:sqlite (DatabaseSync).
 * Replaces the previous JSON file store.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Prefer /tmp for SQLite reliability in constrained environments; override with RAM_DB_PATH
const DATA_DIR = process.env.RAM_DATA_DIR || path.join('/tmp', 'rent-a-mec-data');
const DB_PATH = process.env.RAM_DB_PATH || path.join(DATA_DIR, 'rentamec.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = DELETE;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('buyer', 'mechanic', 'admin')),
    phone TEXT,
    mechanic_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mechanics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    initials TEXT,
    rating REAL DEFAULT 0,
    reviews INTEGER DEFAULT 0,
    years INTEGER DEFAULT 0,
    specialties TEXT NOT NULL DEFAULT '[]',
    bio TEXT,
    area TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    buyer_id TEXT NOT NULL,
    buyer_name TEXT,
    mechanic_id TEXT,
    mechanic_name TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    hours INTEGER NOT NULL,
    rate REAL NOT NULL,
    total REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    zip TEXT NOT NULL,
    vehicle TEXT NOT NULL,
    service_type TEXT DEFAULT 'inspect',
    notes TEXT DEFAULT '',
    payment_status TEXT DEFAULT 'unpaid',
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    cancel_reason TEXT,
    completion_notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (buyer_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL,
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_bookings_buyer ON bookings(buyer_id);
  CREATE INDEX IF NOT EXISTS idx_bookings_mechanic ON bookings(mechanic_id);
  CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
`);

function rowUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    name: r.name,
    role: r.role,
    phone: r.phone,
    mechanicId: r.mechanic_id,
    active: !!r.active,
    createdAt: r.created_at,
  };
}

function rowMechanic(r) {
  if (!r) return null;
  let specialties = [];
  try { specialties = JSON.parse(r.specialties || '[]'); } catch { specialties = []; }
  return {
    id: r.id,
    name: r.name,
    initials: r.initials,
    rating: r.rating,
    reviews: r.reviews,
    years: r.years,
    specialties,
    bio: r.bio,
    area: r.area,
    active: !!r.active,
  };
}

function rowBooking(r) {
  if (!r) return null;
  return {
    id: r.id,
    buyerId: r.buyer_id,
    buyerName: r.buyer_name,
    mechanicId: r.mechanic_id,
    mechanicName: r.mechanic_name,
    status: r.status,
    hours: r.hours,
    rate: r.rate,
    total: r.total,
    currency: r.currency,
    date: r.date,
    time: r.time,
    zip: r.zip,
    vehicle: r.vehicle,
    serviceType: r.service_type,
    notes: r.notes || '',
    paymentStatus: r.payment_status,
    stripeSessionId: r.stripe_session_id,
    stripePaymentIntent: r.stripe_payment_intent,
    cancelReason: r.cancel_reason,
    completionNotes: r.completion_notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---- Users ----
function findUserByEmail(email) {
  const r = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
  return rowUser(r);
}

function findUserById(id) {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return rowUser(r);
}

function insertUser(user) {
  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, role, phone, mechanic_id, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    user.email,
    user.passwordHash,
    user.name,
    user.role,
    user.phone || null,
    user.mechanicId || null,
    user.active ? 1 : 0,
    user.createdAt
  );
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

// ---- Mechanics ----
function listMechanics({ area, specialty, activeOnly = true } = {}) {
  let sql = 'SELECT * FROM mechanics WHERE 1=1';
  const params = [];
  if (activeOnly) {
    sql += ' AND active = 1';
  }
  if (area) {
    sql += ' AND lower(area) LIKE ?';
    params.push('%' + String(area).toLowerCase() + '%');
  }
  const rows = db.prepare(sql).all(...params);
  let list = rows.map(rowMechanic);
  if (specialty) {
    const s = String(specialty).toLowerCase();
    list = list.filter((m) => (m.specialties || []).some((t) => t.toLowerCase().includes(s)));
  }
  return list;
}

function findMechanicById(id) {
  const r = db.prepare('SELECT * FROM mechanics WHERE id = ?').get(id);
  return rowMechanic(r);
}

function upsertMechanic(m) {
  db.prepare(`
    INSERT INTO mechanics (id, name, initials, rating, reviews, years, specialties, bio, area, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, initials=excluded.initials, rating=excluded.rating,
      reviews=excluded.reviews, years=excluded.years, specialties=excluded.specialties,
      bio=excluded.bio, area=excluded.area, active=excluded.active
  `).run(
    m.id,
    m.name,
    m.initials || null,
    m.rating || 0,
    m.reviews || 0,
    m.years || 0,
    JSON.stringify(m.specialties || []),
    m.bio || null,
    m.area || null,
    m.active !== false ? 1 : 0
  );
}

function countMechanics() {
  return db.prepare('SELECT COUNT(*) AS c FROM mechanics').get().c;
}

// ---- Bookings ----
function insertBooking(b) {
  db.prepare(`
    INSERT INTO bookings (
      id, buyer_id, buyer_name, mechanic_id, mechanic_name, status,
      hours, rate, total, currency, date, time, zip, vehicle, service_type, notes,
      payment_status, stripe_session_id, stripe_payment_intent,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.id,
    b.buyerId,
    b.buyerName || null,
    b.mechanicId || null,
    b.mechanicName || null,
    b.status,
    b.hours,
    b.rate,
    b.total,
    b.currency || 'USD',
    b.date,
    b.time,
    b.zip,
    b.vehicle,
    b.serviceType || 'inspect',
    b.notes || '',
    b.paymentStatus || 'unpaid',
    b.stripeSessionId || null,
    b.stripePaymentIntent || null,
    b.createdAt,
    b.updatedAt
  );
}

function findBookingById(id) {
  const r = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  return rowBooking(r);
}

function listBookingsForUser(user) {
  let rows;
  if (user.role === 'buyer') {
    rows = db.prepare('SELECT * FROM bookings WHERE buyer_id = ? ORDER BY created_at DESC').all(user.id);
  } else if (user.role === 'mechanic') {
    rows = db.prepare(`
      SELECT * FROM bookings
      WHERE mechanic_id = ? OR status = 'open'
      ORDER BY created_at DESC
    `).all(user.mechanicId || '');
  } else {
    rows = db.prepare('SELECT * FROM bookings ORDER BY created_at DESC').all();
  }
  return rows.map(rowBooking);
}

function updateBooking(id, fields) {
  const map = {
    mechanicId: 'mechanic_id',
    mechanicName: 'mechanic_name',
    status: 'status',
    paymentStatus: 'payment_status',
    stripeSessionId: 'stripe_session_id',
    stripePaymentIntent: 'stripe_payment_intent',
    cancelReason: 'cancel_reason',
    completionNotes: 'completion_notes',
    updatedAt: 'updated_at',
  };
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) {
      sets.push(col + ' = ?');
      vals.push(fields[k]);
    }
  }
  if (!sets.length) return findBookingById(id);
  vals.push(id);
  db.prepare('UPDATE bookings SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  return findBookingById(id);
}

// ---- Payments ----
function insertPayment(p) {
  db.prepare(`
    INSERT INTO payments (id, booking_id, amount_cents, currency, status, stripe_session_id, stripe_payment_intent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.id,
    p.bookingId,
    p.amountCents,
    p.currency || 'usd',
    p.status,
    p.stripeSessionId || null,
    p.stripePaymentIntent || null,
    p.createdAt
  );
}

function findPaymentBySession(sessionId) {
  const r = db.prepare('SELECT * FROM payments WHERE stripe_session_id = ?').get(sessionId);
  if (!r) return null;
  return {
    id: r.id,
    bookingId: r.booking_id,
    amountCents: r.amount_cents,
    currency: r.currency,
    status: r.status,
    stripeSessionId: r.stripe_session_id,
    stripePaymentIntent: r.stripe_payment_intent,
    createdAt: r.created_at,
  };
}

function updatePaymentStatus(id, status, paymentIntent) {
  db.prepare('UPDATE payments SET status = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent) WHERE id = ?')
    .run(status, paymentIntent || null, id);
}

module.exports = {
  db,
  DB_PATH,
  DATA_DIR,
  findUserByEmail,
  findUserById,
  insertUser,
  countUsers,
  listMechanics,
  findMechanicById,
  upsertMechanic,
  countMechanics,
  insertBooking,
  findBookingById,
  listBookingsForUser,
  updateBooking,
  insertPayment,
  findPaymentBySession,
  updatePaymentStatus,
};
