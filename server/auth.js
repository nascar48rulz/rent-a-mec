const crypto = require('crypto');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'rent-a-mec-prod-secret-change-in-real-deploy-2026';

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(plain, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(plain, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch {
    return false;
  }
}

function signToken(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    mechanicId: user.mechanicId || null,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function uuid() {
  return crypto.randomUUID();
}

function register({ email, password, name, role = 'buyer', phone }) {
  if (db.findUserByEmail(email)) {
    const err = new Error('Email already registered');
    err.status = 409;
    throw err;
  }
  if (!['buyer', 'mechanic'].includes(role)) {
    const err = new Error('Role must be buyer or mechanic');
    err.status = 400;
    throw err;
  }
  const user = {
    id: uuid(),
    email: email.toLowerCase().trim(),
    passwordHash: hashPassword(password),
    name: name.trim(),
    role,
    phone: phone || null,
    mechanicId: null,
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.insertUser(user);
  const { passwordHash, ...safe } = user;
  return { user: safe, token: signToken(user) };
}

function login({ email, password }) {
  const user = db.findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }
  if (!user.active) {
    const err = new Error('Account is inactive');
    err.status = 403;
    throw err;
  }
  const { passwordHash, ...safe } = user;
  return { user: safe, token: signToken(user) };
}

function authFromRequest(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = db.findUserById(payload.sub);
  if (!user || !user.active) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mechanicId: user.mechanicId || null,
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  register,
  login,
  authFromRequest,
  uuid,
};
