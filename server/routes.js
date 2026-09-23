const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { getQuote, MAX_HOURS } = require('./pricing');
const { authMiddleware, requireRole, register, login } = require('./auth');

const router = express.Router();

// ---------- Public ----------
router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'rent-a-mec', time: new Date().toISOString() });
});

router.get('/pricing/quote', (req, res) => {
  const hours = parseInt(req.query.hours, 10) || 1;
  res.json(getQuote(hours));
});

router.get('/mechanics', (req, res) => {
  const mechanics = db.read('mechanics').filter((m) => m.active);
  const { area, specialty } = req.query;
  let list = mechanics;
  if (area) {
    list = list.filter((m) => m.area.toLowerCase().includes(String(area).toLowerCase()));
  }
  if (specialty) {
    list = list.filter((m) =>
      m.specialties.some((s) => s.toLowerCase().includes(String(specialty).toLowerCase()))
    );
  }
  // Strip internal notes
  res.json(
    list.map(({ internalNotes, ...m }) => m)
  );
});

router.get('/mechanics/:id', (req, res) => {
  const m = db.read('mechanics').find((x) => x.id === req.params.id && x.active);
  if (!m) return res.status(404).json({ error: 'Mechanic not found' });
  const { internalNotes, ...safe } = m;
  res.json(safe);
});

// ---------- Auth ----------
router.post('/auth/register', (req, res) => {
  try {
    const { email, password, name, role, phone } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password, and name are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const result = register({ email, password, name, role, phone });
    res.status(201).json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/auth/login', (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const result = login({ email, password });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/auth/me', authMiddleware, (req, res) => {
  const users = db.read('users');
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash, ...safe } = user;
  res.json(safe);
});

// ---------- Bookings (buyers) ----------
router.post('/bookings', authMiddleware, requireRole('buyer', 'admin'), (req, res) => {
  try {
    const {
      mechanicId,
      hours,
      date,
      time,
      zip,
      vehicle,
      serviceType,
      notes,
    } = req.body || {};

    if (!date || !time || !zip || !vehicle) {
      return res.status(400).json({ error: 'date, time, zip, and vehicle are required' });
    }

    const quote = getQuote(hours);
    if (quote.hours < 1 || quote.hours > MAX_HOURS) {
      return res.status(400).json({ error: `Hours must be between 1 and ${MAX_HOURS}` });
    }

    let mechanic = null;
    if (mechanicId) {
      mechanic = db.read('mechanics').find((m) => m.id === mechanicId && m.active);
      if (!mechanic) return res.status(404).json({ error: 'Selected mechanic not found' });
    }

    const booking = {
      id: uuidv4(),
      buyerId: req.user.id,
      buyerName: req.user.name,
      mechanicId: mechanic ? mechanic.id : null,
      mechanicName: mechanic ? mechanic.name : null,
      status: mechanic ? 'requested' : 'open', // open = any mechanic can claim
      hours: quote.hours,
      rate: quote.rate,
      total: quote.total,
      currency: 'USD',
      date,
      time,
      zip: String(zip).trim(),
      vehicle: String(vehicle).trim(),
      serviceType: serviceType || 'inspect',
      notes: notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const bookings = db.read('bookings');
    bookings.push(booking);
    db.write('bookings', bookings);

    res.status(201).json(booking);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/bookings/mine', authMiddleware, (req, res) => {
  const bookings = db.read('bookings');
  let list;
  if (req.user.role === 'buyer') {
    list = bookings.filter((b) => b.buyerId === req.user.id);
  } else if (req.user.role === 'mechanic') {
    list = bookings.filter(
      (b) => b.mechanicId === req.user.mechanicId || b.status === 'open'
    );
  } else {
    list = bookings;
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

router.get('/bookings/:id', authMiddleware, (req, res) => {
  const booking = db.read('bookings').find((b) => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const isBuyer = booking.buyerId === req.user.id;
  const isAssignedMech =
    req.user.role === 'mechanic' && booking.mechanicId === req.user.mechanicId;
  const isOpenAndMech = req.user.role === 'mechanic' && booking.status === 'open';
  const isAdmin = req.user.role === 'admin';

  if (!isBuyer && !isAssignedMech && !isOpenAndMech && !isAdmin) {
    return res.status(403).json({ error: 'Not allowed to view this booking' });
  }
  res.json(booking);
});

// Mechanic accepts an open or requested booking
router.post('/bookings/:id/accept', authMiddleware, requireRole('mechanic'), (req, res) => {
  const bookings = db.read('bookings');
  const idx = bookings.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });

  const b = bookings[idx];
  if (!['open', 'requested'].includes(b.status)) {
    return res.status(400).json({ error: `Cannot accept booking in status: ${b.status}` });
  }
  if (b.mechanicId && b.mechanicId !== req.user.mechanicId) {
    return res.status(403).json({ error: 'This booking is assigned to another mechanic' });
  }

  const mechanics = db.read('mechanics');
  const mech = mechanics.find((m) => m.id === req.user.mechanicId);
  if (!mech) return res.status(400).json({ error: 'Mechanic profile not linked' });

  b.mechanicId = mech.id;
  b.mechanicName = mech.name;
  b.status = 'confirmed';
  b.updatedAt = new Date().toISOString();
  bookings[idx] = b;
  db.write('bookings', bookings);
  res.json(b);
});

// Buyer or mechanic cancels
router.post('/bookings/:id/cancel', authMiddleware, (req, res) => {
  const bookings = db.read('bookings');
  const idx = bookings.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });

  const b = bookings[idx];
  const isBuyer = b.buyerId === req.user.id;
  const isMech = req.user.role === 'mechanic' && b.mechanicId === req.user.mechanicId;
  if (!isBuyer && !isMech && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not allowed' });
  }
  if (['completed', 'cancelled'].includes(b.status)) {
    return res.status(400).json({ error: `Already ${b.status}` });
  }

  b.status = 'cancelled';
  b.updatedAt = new Date().toISOString();
  b.cancelReason = (req.body && req.body.reason) || '';
  bookings[idx] = b;
  db.write('bookings', bookings);
  res.json(b);
});

// Mark completed (mechanic)
router.post('/bookings/:id/complete', authMiddleware, requireRole('mechanic'), (req, res) => {
  const bookings = db.read('bookings');
  const idx = bookings.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });

  const b = bookings[idx];
  if (b.mechanicId !== req.user.mechanicId) {
    return res.status(403).json({ error: 'Not your booking' });
  }
  if (b.status !== 'confirmed') {
    return res.status(400).json({ error: 'Only confirmed bookings can be completed' });
  }

  b.status = 'completed';
  b.updatedAt = new Date().toISOString();
  b.completionNotes = (req.body && req.body.notes) || '';
  bookings[idx] = b;
  db.write('bookings', bookings);
  res.json(b);
});

module.exports = router;
