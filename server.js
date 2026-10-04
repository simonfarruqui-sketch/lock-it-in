// Lock It In: all-or-nothing trip deposits.
// Everyone puts down a deposit by the deadline, or the trip is off and everyone is refunded.
// Lock It In never touches money. Friends pay the organizer directly (Venmo, Cash App,
// PayPal, Zelle, Apple Cash, or cash), and the organizer confirms each deposit here.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const DEMO_RESET_MS = 30 * 60 * 1000;
const METHODS = ['venmo', 'cashapp', 'paypal', 'zelle', 'applecash', 'cash'];
const REASONS = ['dates', 'money', 'not_sure', 'forgot', 'other'];

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  // The organizer key lives in the URL, so never leak it to other sites via Referer.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/t/:id', sendTripPage);
app.use(express.static(path.join(__dirname, 'public')));

// ---------- simple in-memory rate limiting (enough for a public MVP) ----------
const hits = new Map();
function clientIp(req) { return req.get('fly-client-ip') || req.ip || 'unknown'; }
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const k = name + ':' + clientIp(req);
    const now = Date.now();
    const h = hits.get(k);
    if (!h || now > h.reset) { hits.set(k, { n: 1, reset: now + windowMs }); return next(); }
    if (++h.n > max) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now > h.reset) hits.delete(k); }, 60000).unref();
app.post('/api/trips', limit('create', 30, 60 * 60 * 1000));
app.use('/api', (req, res, next) => (req.method === 'GET' ? next() : limit('write', 120, 60 * 1000)(req, res, next)));

// ---------- storage (a single JSON file, written atomically) ----------
let db = { trips: {} };
function load() {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!db || typeof db.trips !== 'object') db = { trips: {} };
  } catch (e) {
    db = { trips: {} };
  }
}
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- helpers ----------
const newId = (bytes = 5) => crypto.randomBytes(bytes).toString('base64url');
const nowIso = () => new Date().toISOString();
function str(v, max = 80) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}
function hoursBetween(a, b) {
  return Math.max(0, (Date.parse(b) - Date.parse(a)) / 3600000);
}
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function phaseOf(t, now = Date.now()) {
  const n = t.members.length;
  if (n && t.members.every((m) => m.status === 'confirmed')) return 'locked';
  const deadline = Date.parse(t.deadline);
  if (now <= deadline) return 'open';
  // After the deadline: if everyone said they paid before time ran out, give the organizer
  // time to confirm instead of punishing the group for a slow bank transfer.
  const allIn = n && t.members.every(
    (m) => m.status === 'confirmed' || (m.status === 'claimed' && Date.parse(m.claimedAt) <= deadline)
  );
  return allIn ? 'verifying' : 'released';
}

function refreshLock(t) {
  if (phaseOf(t) === 'locked' && !t.lockedAt) t.lockedAt = nowIso();
  if (phaseOf(t) !== 'locked') t.lockedAt = null;
}

function stats(t) {
  const n = t.members.length;
  const confirmed = t.members.filter((m) => m.status === 'confirmed');
  const claimed = t.members.filter((m) => m.status === 'claimed');
  const out = t.members.filter((m) => m.status === 'out');
  const claimHours = t.members.filter((m) => m.claimedAt).map((m) => hoursBetween(t.openedAt, m.claimedAt));
  const byMethod = {};
  t.members.forEach((m) => { if (m.method) byMethod[m.method] = (byMethod[m.method] || 0) + 1; });
  const reasons = {};
  t.members.forEach((m) => { if (m.reason) reasons[m.reason] = (reasons[m.reason] || 0) + 1; });
  return {
    seats: n,
    confirmed: confirmed.length,
    claimed: claimed.length,
    out: out.length,
    open: n - confirmed.length - claimed.length - out.length,
    medianHoursToSend: claimHours.length ? +median(claimHours).toFixed(1) : null,
    within24h: claimHours.filter((h) => h <= 24).length,
    hoursToLock: t.lockedAt ? +hoursBetween(t.openedAt, t.lockedAt).toFixed(1) : null,
    lockedBeforeDeadline: !!(t.lockedAt && Date.parse(t.lockedAt) <= Date.parse(t.deadline)),
    byMethod,
    reasons,
    nudgesSent: t.nudges || 0,
  };
}

function view(t, isOrganizer) {
  return {
    id: t.id,
    name: t.name,
    destination: t.destination,
    dates: t.dates,
    deposit: t.deposit,
    covers: t.covers,
    organizerName: t.organizerName,
    openedAt: t.openedAt,
    deadline: t.deadline,
    lockedAt: t.lockedAt,
    methods: t.methods,
    phase: phaseOf(t),
    serverNow: Date.now(),
    isOrganizer,
    members: t.members.map((m) => {
      const base = { id: m.id, name: m.name, status: m.status, method: m.method, refunded: !!m.refunded, gaveReason: !!m.reason };
      if (!isOrganizer) return base;
      return { ...base, claimedAt: m.claimedAt, confirmedAt: m.confirmedAt, reason: m.reason, reasonNote: m.reasonNote, reasonAt: m.reasonAt };
    }),
    stats: isOrganizer ? stats(t) : undefined,
  };
}

function getTrip(req, res) {
  if (req.params.id === 'demo') maybeResetDemo();
  const t = Object.prototype.hasOwnProperty.call(db.trips, req.params.id) ? db.trips[req.params.id] : null;
  if (!t) { res.status(404).json({ error: 'This trip link does not exist. Check the link with your organizer.' }); return null; }
  return t;
}
function isOrg(req, t) {
  const key = String(req.get('x-organizer-key') || req.query.key || '');
  if (!key || key.length !== t.key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(t.key));
}
function requireOrg(req, res, t) {
  if (!isOrg(req, t)) { res.status(403).json({ error: 'Only the organizer can do that.' }); return false; }
  return true;
}
function findMember(t, id, res) {
  const m = t.members.find((x) => x.id === id);
  if (!m) { res.status(404).json({ error: 'That seat is not on this trip.' }); return null; }
  return m;
}
function makeMember(name) {
  return { id: newId(4), name: str(name, 30), status: 'open', method: null, claimedAt: null, confirmedAt: null, reason: null, reasonNote: null, reasonAt: null, refunded: false };
}

// ---------- create a trip ----------
app.post('/api/trips', (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 60);
  const organizerName = str(b.organizerName, 30);
  const deposit = Math.round(Number(b.deposit) * 100) / 100;
  const hours = Math.min(336, Math.max(1, Number(b.hours) || 72));
  const methods = {};
  ['venmo', 'cashapp', 'paypal', 'zelle', 'applecash'].forEach((k) => {
    const v = str(b.methods && b.methods[k], 60).replace(/^[@$]/, '');
    if (v) methods[k] = v;
  });
  if (b.methods && b.methods.cash) methods.cash = true;

  const friendNames = String(b.friends || '').split(/\n|,/).map((s) => str(s, 30)).filter(Boolean);
  const seen = new Set();
  const names = [organizerName, ...friendNames].filter((nm) => {
    const k = nm.toLowerCase();
    if (!nm || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!name) return res.status(400).json({ error: 'Give the trip a name.' });
  if (!organizerName) return res.status(400).json({ error: 'Add your own name. You hold a seat too.' });
  if (!(deposit >= 1)) return res.status(400).json({ error: 'Set a deposit of at least $1.' });
  if (deposit > 10000) return res.status(400).json({ error: 'Keep the deposit under $10,000.' });
  if (names.length < 2) return res.status(400).json({ error: 'Add at least one friend.' });
  if (names.length > 25) return res.status(400).json({ error: 'Lock It In works for up to 25 people.' });
  if (!Object.keys(methods).length) return res.status(400).json({ error: 'Add at least one way for friends to pay you.' });

  const now = Date.now();
  const t = {
    id: newId(5),
    key: newId(12),
    name,
    destination: str(b.destination, 60),
    dates: str(b.dates, 40),
    deposit,
    covers: str(b.covers, 140),
    organizerName,
    hours,
    methods,
    createdAt: new Date(now).toISOString(),
    openedAt: new Date(now).toISOString(),
    deadline: new Date(now + hours * 3600000).toISOString(),
    lockedAt: null,
    nudges: 0,
    members: names.map(makeMember),
  };
  db.trips[t.id] = t;
  save();
  res.json({ id: t.id, key: t.key });
});

// ---------- read a trip (friend view, or organizer view with the key) ----------
app.get('/api/trips/:id', (req, res) => {
  const t = getTrip(req, res); if (!t) return;
  res.json(view(t, isOrg(req, t)));
});

// ---------- friend actions ----------
app.post('/api/trips/:id/claim', (req, res) => {
  const t = getTrip(req, res); if (!t) return;
  if (phaseOf(t) !== 'open') return res.status(409).json({ error: 'The deadline has passed, so this trip is closed.' });
  const m = findMember(t, str(req.body.memberId, 20), res); if (!m) return;
  const method = str(req.body.method, 20);
  if (!METHODS.includes(method) || !t.methods[method]) return res.status(400).json({ error: 'Pick one of the payment options on this trip.' });
  if (m.status === 'confirmed') return res.status(409).json({ error: 'Your deposit is already confirmed.' });
  m.status = 'claimed';
  m.method = method;
  m.claimedAt = nowIso();
  m.reason = null; m.reasonNote = null; m.reasonAt = null;
  save();
  res.json(view(t, false));
});

app.post('/api/trips/:id/unclaim', (req, res) => {
  const t = getTrip(req, res); if (!t) return;
  const m = findMember(t, str(req.body.memberId, 20), res); if (!m) return;
  if (m.status !== 'claimed') return res.status(409).json({ error: 'Only an unconfirmed deposit can be undone.' });
  if (phaseOf(t) !== 'open') return res.status(409).json({ error: 'The deadline has passed.' });
  m.status = 'open'; m.method = null; m.claimedAt = null;
  save();
  res.json(view(t, false));
});

app.post('/api/trips/:id/reason', (req, res) => {
  const t = getTrip(req, res); if (!t) return;
  const m = findMember(t, str(req.body.memberId, 20), res); if (!m) return;
  const reason = str(req.body.reason, 20);
  if (!REASONS.includes(reason)) return res.status(400).json({ error: 'Pick one of the options.' });
  if (m.status === 'confirmed') return res.status(409).json({ error: 'Your deposit is already confirmed.' });
  m.reason = reason;
  m.reasonNote = str(req.body.note, 200) || null;
  m.reasonAt = nowIso();
  if (req.body.out && phaseOf(t) === 'open' && m.status === 'open') m.status = 'out';
  save();
  res.json(view(t, false));
});

app.post('/api/trips/:id/back-in', (req, res) => {
  const t = getTrip(req, res); if (!t) return;
  const m = findMember(t, str(req.body.memberId, 20), res); if (!m) return;
  if (m.status !== 'out' || phaseOf(t) !== 'open') return res.status(409).json({ error: 'Nothing to undo.' });
  m.status = 'open';
  save();
  res.json(view(t, false));
});

// ---------- organizer actions ----------
app.post('/api/trips/:id/confirm', (req, res) => {
  const t = getTrip(req, res); if (!t || !requireOrg(req, res, t)) return;
  const m = findMember(t, str(req.body.memberId, 20), res); if (!m) return;
  if (req.body.value) {
    if (!m.claimedAt) { m.claimedAt = nowIso(); const pm = str(req.body.method, 20); m.method = m.method || (METHODS.includes(pm) ? pm : 'cash'); }
    m.status = 'confirmed';
    m.confirmedAt = nowIso();
  } else {
    m.status = m.claimedAt ? 'claimed' : 'open';
    m.confirmedAt = null;
  }
  refreshLock(t);
  save();
  res.json(view(t, true));
});

app.post('/api/trips/:id/refund', (req, res) => {
  const t = getTrip(req, res); if (!t || !requireOrg(req, res, t)) return;
  const m = findMember(t, str(req.body.memberId, 20), res); if (!m) return;
  m.refunded = !!req.body.value;
  save();
  res.json(view(t, true));
});

app.post('/api/trips/:id/members', (req, res) => {
  const t = getTrip(req, res); if (!t || !requireOrg(req, res, t)) return;
  const nm = str(req.body.name, 30);
  if (!nm) return res.status(400).json({ error: 'Type a name.' });
  if (t.members.some((m) => m.name.toLowerCase() === nm.toLowerCase())) return res.status(409).json({ error: 'That name is already on the trip.' });
  if (t.members.length >= 25) return res.status(400).json({ error: 'Lock It In works for up to 25 people.' });
  t.members.push(makeMember(nm));
  refreshLock(t);
  save();
  res.json(view(t, true));
});

app.delete('/api/trips/:id/members/:memberId', (req, res) => {
  const t = getTrip(req, res); if (!t || !requireOrg(req, res, t)) return;
  const before = t.members.length;
  t.members = t.members.filter((m) => m.id !== req.params.memberId);
  if (t.members.length === before) return res.status(404).json({ error: 'That seat is not on this trip.' });
  refreshLock(t);
  save();
  res.json(view(t, true));
});

app.post('/api/trips/:id/restart', (req, res) => {
  const t = getTrip(req, res); if (!t || !requireOrg(req, res, t)) return;
  const now = Date.now();
  t.openedAt = new Date(now).toISOString();
  t.deadline = new Date(now + (t.hours || 72) * 3600000).toISOString();
  refreshLock(t);
  save();
  res.json(view(t, true));
});

app.post('/api/trips/:id/nudge', (req, res) => {
  const t = getTrip(req, res); if (!t || !requireOrg(req, res, t)) return;
  t.nudges = (t.nudges || 0) + 1;
  save();
  res.json(view(t, true));
});

// ---------- research export ----------
app.get('/api/trips/:id/export.csv', (req, res) => {
  const t = getTrip(req, res); if (!t || !requireOrg(req, res, t)) return;
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const s = stats(t);
  const rows = [
    ['trip_id', 'trip_name', 'seats', 'opened_at', 'deadline', 'phase_now', 'locked_at', 'hours_to_lock', 'locked_before_deadline', 'nudges_sent'],
    [t.id, t.name, t.members.length, t.openedAt, t.deadline, phaseOf(t), t.lockedAt || '', s.hoursToLock == null ? '' : s.hoursToLock, s.lockedBeforeDeadline, t.nudges || 0],
    [],
    ['name', 'status', 'method', 'sent_at', 'hours_after_open', 'confirmed_at', 'reason', 'reason_note', 'refunded'],
    ...t.members.map((m) => [m.name, m.status, m.method || '', m.claimedAt || '', m.claimedAt ? hoursBetween(t.openedAt, m.claimedAt).toFixed(2) : '', m.confirmedAt || '', m.reason || '', m.reasonNote || '', m.refunded ? 'yes' : 'no']),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="lock-it-in-${t.id}.csv"`);
  res.send(rows.map((r) => r.map(q).join(',')).join('\n'));
});

// ---------- pages ----------
// Trip pages get link-preview tags so the friend link looks right in a group chat.
const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let tripHtml = null;
function sendTripPage(req, res) {
  if (!tripHtml) tripHtml = fs.readFileSync(path.join(__dirname, 'public', 'trip.html'), 'utf8');
  if (req.params.id === 'demo') maybeResetDemo();
  const t = Object.prototype.hasOwnProperty.call(db.trips, req.params.id) ? db.trips[req.params.id] : null;
  let tags = '';
  if (t) {
    const amt = '$' + (t.deposit % 1 ? t.deposit.toFixed(2) : t.deposit);
    const title = escHtml(t.name + ' | Lock It In');
    const desc = escHtml(`Everyone puts down ${amt} by the deadline, or nobody does. ${t.members.length} seats. Pick your name to lock in.`);
    tags = `<title>${title}</title><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta name="description" content="${desc}"><meta property="og:type" content="website">`;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(tags ? tripHtml.replace('<title>Lock It In</title>', tags) : tripHtml);
}

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) return res.status(400).json({ error: 'That request could not be read.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end. Try again.' });
});

// ---------- demo trip for screen-sharing ----------
// The demo is public (anyone can open the organizer view), so it resets itself every 30 minutes.
function maybeResetDemo() {
  const d = db.trips.demo;
  if (!d || !d.seededAt || Date.now() - Date.parse(d.seededAt) > DEMO_RESET_MS) seedDemo(true);
}
function seedDemo(force) {
  if (db.trips.demo && !force) return;
  const now = Date.now();
  const opened = now - 20 * 3600000;
  const at = (h) => new Date(opened + h * 3600000).toISOString();
  const m = (name, status, method, h) => ({ ...makeMember(name), status, method, claimedAt: h == null ? null : at(h), confirmedAt: status === 'confirmed' ? at(h + 1) : null });
  db.trips.demo = {
    id: 'demo', key: 'demo-organizer', name: 'Montreal weekend', destination: 'Montreal, QC', dates: 'Nov 13 to 15',
    deposit: 75, covers: 'Holds our Airbnb. Booked the minute everyone is in.', organizerName: 'Maya', hours: 72,
    methods: { venmo: 'maya-demo', cashapp: 'mayademo', zelle: 'maya@example.com', applecash: '(555) 010-0199', cash: true },
    createdAt: new Date(opened).toISOString(), openedAt: new Date(opened).toISOString(), deadline: new Date(opened + 72 * 3600000).toISOString(),
    lockedAt: null, nudges: 1, seededAt: new Date(now).toISOString(),
    members: [m('Maya', 'confirmed', 'cash', 0.1), m('Jess', 'confirmed', 'venmo', 1.6), m('Priya', 'confirmed', 'zelle', 13.2), m('Omar', 'claimed', 'cashapp', 18.5), m('Dev', 'open', null, null), m('Lauren', 'open', null, null)],
  };
  save();
}

fs.mkdirSync(DATA_DIR, { recursive: true });
load();
maybeResetDemo();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lock It In is running on port ${PORT}`);
  console.log('Demo trip: /t/demo   Demo organizer view: /t/demo?key=demo-organizer');
});
