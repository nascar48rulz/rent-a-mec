/**
 * Rent-a-mec production client
 * Talks to /api — JWT stored in localStorage
 */
const API = '/api';
const TOKEN_KEY = 'ram_token';
const USER_KEY = 'ram_user';

let currentUser = null;
let mechanicsCache = [];

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  currentUser = user;
  updateAuthUI();
}
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  currentUser = null;
  updateAuthUI();
}
function loadSession() {
  try {
    const u = localStorage.getItem(USER_KEY);
    currentUser = u ? JSON.parse(u) : null;
  } catch {
    currentUser = null;
  }
  updateAuthUI();
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

function showSection(id) {
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  document.getElementById('nav')?.classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'mechanics') loadMechanics();
  if (id === 'dashboard') loadDashboard();
  if (id === 'book') refreshBookFormAuth();
}

document.querySelectorAll('[data-nav]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    showSection(el.getAttribute('data-nav'));
  });
});

document.getElementById('menuToggle')?.addEventListener('click', () => {
  document.getElementById('nav').classList.toggle('open');
});

function updateAuthUI() {
  const loggedIn = !!currentUser;
  document.getElementById('navLogin')?.classList.toggle('hidden', loggedIn);
  document.getElementById('navLogout')?.classList.toggle('hidden', !loggedIn);
  document.getElementById('navDash')?.classList.toggle('hidden', !loggedIn);
}

document.getElementById('navLogout')?.addEventListener('click', () => {
  clearSession();
  showSection('home');
});

function formatMoney(n) {
  return '$' + Number(n).toLocaleString('en-US');
}

async function fetchQuote(hours) {
  try {
    return await api('/pricing/quote?hours=' + hours);
  } catch {
    const h = Math.min(Math.max(+hours || 1, 1), 4);
    const rate = h === 4 ? 89 : 95;
    return { hours: h, rate, total: rate * h, label: h === 4 ? 'Extended rate (4-hr discount)' : 'Standard hourly rate' };
  }
}

function bindPills(containerId, onChange) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.querySelectorAll('.pill').forEach((pill) => {
    pill.addEventListener('click', async () => {
      c.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      const q = await fetchQuote(pill.dataset.hrs);
      onChange(q, pill.dataset.hrs);
    });
  });
}

bindPills('heroDuration', (q, hrs) => {
  document.getElementById('heroPrice').textContent = formatMoney(q.total);
  document.getElementById('heroNote').textContent = q.label;
  const details = {
    1: 'Perfect for a focused pre-purchase inspection.',
    2: 'Good balance of inspection depth + light support.',
    3: 'Thorough check plus time for questions and negotiation.',
    4: 'Maximum session — deeper inspection or longer support at a discounted rate.',
  };
  document.getElementById('heroDetail').textContent = details[hrs] || '';
});

bindPills('calcDuration', (q) => {
  document.getElementById('calcTotal').textContent = formatMoney(q.total);
  document.getElementById('calcNote').textContent = q.label;
});

async function loadMechanics() {
  const grid = document.getElementById('mechanicsGrid');
  if (!grid) return;
  grid.innerHTML = '<p class="muted">Loading mechanics…</p>';
  try {
    mechanicsCache = await api('/mechanics');
    if (!mechanicsCache.length) {
      grid.innerHTML = '<p class="muted">No mechanics available. Run npm run seed.</p>';
      return;
    }
    grid.innerHTML = mechanicsCache.map((m) => `
      <article class="mechanic-card">
        <div class="mechanic-header">
          <div class="mechanic-avatar">${m.initials || m.name.slice(0, 2)}</div>
          <div>
            <div class="mechanic-name">${m.name}</div>
            <div class="mechanic-meta">${m.years} yrs · ${m.area}</div>
            <div class="mechanic-rating">★ ${m.rating} · ${m.reviews} reviews</div>
          </div>
        </div>
        <div class="mechanic-tags">
          ${(m.specialties || []).map((t) => '<span class="tag">' + t + '</span>').join('')}
        </div>
        <p class="mechanic-bio">${m.bio || ''}</p>
        <button class="btn btn-primary btn-sm" data-select-mech="${m.id}">Book ${m.name.split(' ')[0]}</button>
      </article>`).join('');

    grid.querySelectorAll('[data-select-mech]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showSection('book');
        const sel = document.getElementById('mechanicPref');
        if (sel) sel.value = btn.getAttribute('data-select-mech');
      });
    });
    populateMechanicSelect();
  } catch (e) {
    grid.innerHTML = '<p class="form-error">Failed to load mechanics: ' + e.message + '</p>';
  }
}

function populateMechanicSelect() {
  const sel = document.getElementById('mechanicPref');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Any available specialist</option>';
  mechanicsCache.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name + ' · ★' + m.rating + ' · ' + m.area;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

async function updateFormTotal() {
  const hours = document.getElementById('duration')?.value || '1';
  const q = await fetchQuote(hours);
  document.getElementById('formTotal').textContent = formatMoney(q.total);
  document.getElementById('formNote').textContent = q.label + '. Confirmed when booking is created.';
}

document.getElementById('duration')?.addEventListener('change', updateFormTotal);

(function setMinDate() {
  const d = document.getElementById('date');
  if (!d) return;
  const today = new Date().toISOString().split('T')[0];
  d.min = today;
  if (!d.value) d.value = today;
})();

function refreshBookFormAuth() {
  const hint = document.getElementById('bookAuthHint');
  const form = document.getElementById('bookingForm');
  const success = document.getElementById('bookingSuccess');
  if (!currentUser) {
    hint.textContent = 'Log in as a buyer to create a booking. Demo: buyer@demo.com / demo1234';
  } else if (currentUser.role !== 'buyer') {
    hint.textContent = 'You are logged in as ' + currentUser.role + '. Switch to a buyer account to create bookings.';
  } else {
    hint.textContent = 'Booking as ' + currentUser.name + ' (' + currentUser.email + ')';
  }
  success?.classList.add('hidden');
  form?.classList.remove('hidden');
  updateFormTotal();
  if (!mechanicsCache.length) loadMechanics();
  else populateMechanicSelect();
}

document.getElementById('bookingForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('bookError');
  errEl.classList.add('hidden');
  if (!currentUser) {
    showSection('auth');
    return;
  }
  if (currentUser.role !== 'buyer') {
    errEl.textContent = 'Only buyer accounts can create bookings.';
    errEl.classList.remove('hidden');
    return;
  }
  const body = {
    serviceType: document.getElementById('serviceType').value,
    hours: document.getElementById('duration').value,
    date: document.getElementById('date').value,
    time: document.getElementById('time').value,
    zip: document.getElementById('zip').value,
    vehicle: document.getElementById('vehicle').value,
    notes: document.getElementById('notes').value,
    mechanicId: document.getElementById('mechanicPref').value || null,
  };
  try {
    document.getElementById('bookSubmit').disabled = true;
    const booking = await api('/bookings', { method: 'POST', body: JSON.stringify(body) });
    document.getElementById('bookingForm').classList.add('hidden');
    const success = document.getElementById('bookingSuccess');
    success.classList.remove('hidden');
    document.getElementById('successMessage').innerHTML =
      'Booking <strong>' + booking.id.slice(0, 8) + '…</strong> created for <strong>' +
      booking.vehicle + '</strong> on <strong>' + booking.date + '</strong> at <strong>' +
      booking.time + '</strong>.<br>Total: <strong>' + formatMoney(booking.total) +
      '</strong> · Status: <strong>' + booking.status + '</strong>' +
      (booking.mechanicName ? '<br>Assigned preference: ' + booking.mechanicName : '<br>Open for any mechanic to accept.') +
      '<br><br>Pay from <strong>My bookings</strong> to confirm the session.';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    document.getElementById('bookSubmit').disabled = false;
  }
});

document.getElementById('bookAnother')?.addEventListener('click', () => {
  document.getElementById('bookingForm').reset();
  document.getElementById('bookingForm').classList.remove('hidden');
  document.getElementById('bookingSuccess').classList.add('hidden');
  const d = document.getElementById('date');
  if (d) {
    const today = new Date().toISOString().split('T')[0];
    d.min = today;
    d.value = today;
  }
  updateFormTotal();
});

document.querySelectorAll('.auth-tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tabs .tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    document.getElementById('loginForm').classList.toggle('hidden', !isLogin);
    document.getElementById('registerForm').classList.toggle('hidden', isLogin);
    document.getElementById('authTitle').textContent = isLogin ? 'Log in' : 'Create account';
  });
});

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value,
      }),
    });
    setSession(data.token, data.user);
    showSection(data.user.role === 'mechanic' ? 'dashboard' : 'book');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('regError');
  errEl.classList.add('hidden');
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        password: document.getElementById('regPassword').value,
        role: document.getElementById('regRole').value,
      }),
    });
    setSession(data.token, data.user);
    showSection(data.user.role === 'mechanic' ? 'dashboard' : 'book');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

async function loadDashboard() {
  const content = document.getElementById('dashContent');
  const sub = document.getElementById('dashSubtitle');
  if (!currentUser) {
    content.innerHTML = '<p class="muted">Please log in to see bookings.</p>';
    return;
  }
  sub.textContent =
    currentUser.role === 'mechanic'
      ? 'Jobs assigned to you and open requests you can accept.'
      : 'Your booking requests and their status.';
  content.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const bookings = await api('/bookings/mine');
    if (!bookings.length) {
      content.innerHTML = '<p class="muted">No bookings yet.</p>';
      return;
    }
    content.innerHTML = '<div class="booking-list">' + bookings.map((b) => {
      const actions = [];
      const payStatus = b.paymentStatus || 'unpaid';
      if (currentUser.role === 'buyer' && payStatus !== 'paid' && !['cancelled', 'completed'].includes(b.status)) {
        actions.push('<button class="btn btn-primary btn-sm" data-action="pay" data-id="' + b.id + '">Pay ' + formatMoney(b.total) + '</button>');
      }
      if (currentUser.role === 'mechanic' && ['open', 'requested'].includes(b.status)) {
        actions.push('<button class="btn btn-primary btn-sm" data-action="accept" data-id="' + b.id + '">Accept</button>');
      }
      if (currentUser.role === 'mechanic' && b.status === 'confirmed' && b.mechanicId === currentUser.mechanicId) {
        actions.push('<button class="btn btn-primary btn-sm" data-action="complete" data-id="' + b.id + '">Mark complete</button>');
      }
      if (['open', 'requested', 'confirmed'].includes(b.status)) {
        actions.push('<button class="btn btn-ghost btn-sm" data-action="cancel" data-id="' + b.id + '">Cancel</button>');
      }
      const payPill = '<span class="status-pill status-pay-' + payStatus + '">' + payStatus + '</span>';
      return '<div class="booking-item"><div><h4>' + b.vehicle + '</h4><div class="booking-meta">' +
        b.date + ' · ' + b.time + ' · ' + b.hours + 'h · ' + formatMoney(b.total) +
        (b.mechanicName ? ' · ' + b.mechanicName : '') + ' · ZIP ' + b.zip +
        '</div><div style="margin-top:0.5rem"><span class="status-pill status-' + b.status + '">' + b.status +
        '</span> ' + payPill + '</div>' + (b.notes ? '<p class="booking-meta" style="margin-top:0.5rem">' + b.notes + '</p>' : '') +
        '</div><div class="booking-actions">' + actions.join('') + '</div></div>';
    }).join('') + '</div>';

    content.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        btn.disabled = true;
        try {
          if (action === 'pay') {
            const session = await api('/bookings/' + id + '/pay', { method: 'POST', body: '{}' });
            if (session.url) {
              window.location.href = session.url;
              return;
            }
            alert('Payment started');
          }
          if (action === 'accept') await api('/bookings/' + id + '/accept', { method: 'POST', body: '{}' });
          if (action === 'complete') await api('/bookings/' + id + '/complete', { method: 'POST', body: '{}' });
          if (action === 'cancel') await api('/bookings/' + id + '/cancel', { method: 'POST', body: JSON.stringify({ reason: 'Cancelled by user' }) });
          loadDashboard();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      });
    });
  } catch (e) {
    content.innerHTML = '<p class="form-error">' + e.message + '</p>';
  }
}

async function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  const sessionId = params.get('session_id');
  if (!payment) return;
  // Clean URL
  window.history.replaceState({}, '', window.location.pathname);
  if (payment === 'success' && sessionId) {
    try {
      const result = await api('/payments/confirm?session_id=' + encodeURIComponent(sessionId));
      if (result.paid) {
        alert(result.demo
          ? 'Demo payment recorded — booking marked as paid.'
          : 'Payment successful — booking is paid.');
      }
    } catch (e) {
      console.warn(e);
    }
    if (currentUser) showSection('dashboard');
  } else if (payment === 'cancelled') {
    alert('Payment cancelled. You can pay later from My bookings.');
    if (currentUser) showSection('dashboard');
  }
}

loadSession();
handlePaymentReturn();
updateFormTotal();
api('/mechanics').then((list) => {
  mechanicsCache = list;
  populateMechanicSelect();
}).catch(() => {});
