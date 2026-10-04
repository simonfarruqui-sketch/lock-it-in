(function () {
  var tripId = location.pathname.split('/').filter(Boolean)[1];
  var key = new URLSearchParams(location.search).get('key') || '';
  var trip = null, lastJson = '', clockOffset = 0;
  var ui = { method: null, showOut: false, error: '' };
  var meKey = 'lii:' + tripId;
  var me = '';
  try { me = localStorage.getItem(meKey) || ''; } catch (e) {}
  function methodLabel(k) { return (METHOD_INFO[k] || { label: k }).label; }

  var METHOD_INFO = {
    venmo: { label: 'Venmo', sub: function (h) { return '@' + h; } },
    cashapp: { label: 'Cash App', sub: function (h) { return '$' + h; } },
    paypal: { label: 'PayPal', sub: function (h) { return 'paypal.me/' + h; } },
    zelle: { label: 'Zelle', sub: function (h) { return h; } },
    applecash: { label: 'Apple Cash', sub: function (h) { return h; } },
    cash: { label: 'Cash in person', sub: function () { return 'Hand it over'; } }
  };
  var REASONS = [
    ['dates', 'The dates don\u2019t work for me'],
    ['money', 'Money is tight right now'],
    ['not_sure', 'I\u2019m not sure I want to go'],
    ['forgot', 'I forgot or missed the deadline'],
    ['other', 'Something else']
  ];
  var REASON_LABEL = {}; REASONS.forEach(function (r) { REASON_LABEL[r[0]] = r[1]; });

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function money(n) { return '$' + (Math.round(n * 100) % 100 ? Number(n).toFixed(2) : Math.round(n)); }
  function initials(n) { var p = String(n).trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
  function now() { return Date.now() + clockOffset; }
  function fmtTime(iso) { return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function hoursAfterOpen(iso) { return Math.max(0, (Date.parse(iso) - Date.parse(trip.openedAt)) / 3600000).toFixed(1); }
  function clockText() {
    var ms = Date.parse(trip.deadline) - now();
    if (ms <= 0) return '0h 00m 00s';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600; var m = Math.floor(s / 60); s -= m * 60;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d ? d + 'd ' : '') + h + 'h ' + p(m) + 'm ' + p(s) + 's';
  }
  function toast(t) { var el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove('show'); }, 1900); }
  function copy(text, msg) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(msg || 'Copied'); }, function () { fallbackCopy(text, msg); });
    } else fallbackCopy(text, msg);
  }
  function fallbackCopy(text, msg) {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); toast(ok ? (msg || 'Copied') : 'Press and hold to copy');
  }
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers['x-organizer-key'] = key;
    return fetch('/api/trips/' + encodeURIComponent(tripId) + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); });
  }
  function act(path, body, method) {
    ui.error = '';
    return api(path, { method: method || 'POST', body: body }).then(function () { return load(true); })
      .catch(function (e) { ui.error = e.message; render(); toast(e.message); });
  }
  function payNote(name) { return 'Lock It In deposit: ' + trip.name + (name ? ' (' + name + ')' : ''); }
  function payLink(method, name) {
    var h = trip.methods[method], amt = trip.deposit;
    if (method === 'venmo') return 'https://venmo.com/?txn=pay&recipients=' + encodeURIComponent(h) + '&amount=' + encodeURIComponent(amt) + '&note=' + encodeURIComponent(payNote(name));
    if (method === 'cashapp') return 'https://cash.app/$' + encodeURIComponent(h) + '/' + encodeURIComponent(amt);
    if (method === 'paypal') return 'https://paypal.me/' + encodeURIComponent(h) + '/' + encodeURIComponent(amt) + 'USD';
    return null;
  }
  function friendLink() { return location.origin + '/t/' + tripId; }

  // ---------- data ----------
  function load(force) {
    return api('').then(function (t) {
      clockOffset = t.serverNow - Date.now();
      var j = JSON.stringify(Object.assign({}, t, { serverNow: 0 }));
      trip = t;
      if (me && !t.members.some(function (m) { return m.id === me; })) me = '';
      if (t.isOrganizer && key && tripId !== 'demo') {
        try {
          var l = JSON.parse(localStorage.getItem('lii:mytrips') || '[]').filter(function (x) { return x.id !== tripId; });
          l.unshift({ id: tripId, key: key, name: t.name, at: Date.now() });
          localStorage.setItem('lii:mytrips', JSON.stringify(l.slice(0, 20)));
        } catch (x) {}
      }
      if (force || j !== lastJson) { lastJson = j; render(); }
    }).catch(function (e) {
      if (!trip) $('app').innerHTML = '<div class="card"><h2>Trip not found</h2><p>' + esc(e.message) + '</p><a class="btn" href="/">Start your own trip</a></div>';
    });
  }

  // ---------- render ----------
  function render() {
    if (!trip) return;
    var t = trip, n = t.members.length;
    var confirmed = t.members.filter(function (m) { return m.status === 'confirmed'; }).length;
    var claimed = t.members.filter(function (m) { return m.status === 'claimed'; }).length;
    var left = n - confirmed;
    document.title = t.name + ' | Lock It In';

    var stamp = { locked: '<div class="stamp locked">LOCKED</div>', released: '<div class="stamp released">RELEASED</div>', verifying: '<div class="stamp verifying">CHECKING</div>' }[t.phase] || '';
    var clock;
    if (t.phase === 'open') clock = '<div class="clock" id="clock">' + clockText() + '</div><div class="clock-label">left to lock in. Deadline ' + esc(fmtTime(t.deadline)) + '</div>';
    else if (t.phase === 'locked') clock = '<div class="clock">Trip is on.</div><div class="clock-label">All ' + n + ' deposits are confirmed. ' + esc(t.organizerName) + ' is booking it.</div>';
    else if (t.phase === 'verifying') clock = '<div class="clock">Almost there.</div><div class="clock-label">Everyone said they paid before the deadline. ' + esc(t.organizerName) + ' is confirming the last deposits.</div>';
    else clock = '<div class="clock">Trip is off.</div><div class="clock-label">The deadline passed with ' + left + ' ' + (left === 1 ? 'seat' : 'seats') + ' unconfirmed. Every deposit goes back.</div>';

    var seats = t.members.map(function (m) {
      var mark = m.status === 'confirmed' ? '\u2713' : m.status === 'claimed' ? '\u2026' : m.status === 'out' ? '\u00d7' : esc(initials(m.name));
      var word = { confirmed: 'is locked in', claimed: 'says they sent it', out: 'is out', open: 'has not locked in' }[m.status];
      return '<li class="seat ' + m.status + '"><span class="dot" aria-hidden="true">' + mark + '</span>' + esc(m.name) + (m.id === me ? ' (you)' : '') + '<span class="sr"> ' + word + '</span></li>';
    }).join('');

    var tally = t.phase === 'open'
      ? (left === 0 ? '' : left + ' more ' + (left === 1 ? 'deposit' : 'deposits') + ' and this trip is booked.' + (claimed ? ' ' + claimed + ' waiting on ' + esc(t.organizerName) + ' to confirm.' : ''))
      : '';

    var html =
      '<div class="brand"><b>Lock It In</b><span>' + confirmed + ' of ' + n + ' locked in</span></div>' +
      '<section class="pass" aria-label="Trip ticket">' + stamp +
        '<div class="pass-top"><p class="where">' + esc(t.destination || '') + '</p><h1>' + esc(t.name) + '</h1>' +
        '<div class="facts">' + (t.dates ? '<span><strong>' + esc(t.dates) + '</strong></span>' : '') + '<span>Deposit <strong>' + money(t.deposit) + '</strong> each</span><span>Organizer <strong>' + esc(t.organizerName) + '</strong></span></div></div>' +
        '<div class="perf" aria-hidden="true"></div>' +
        '<div class="pass-bottom">' + clock + '<ul class="seats">' + seats + '</ul>' +
        '<div class="legend"><span><i style="background:var(--go)"></i>Locked in</span><span><i style="background:var(--wait)"></i>Sent, not confirmed</span><span><i style="border:1.5px dashed var(--muted)"></i>Not yet</span><span><i style="background:var(--stop)"></i>Out</span></div>' +
        '<div class="tally">' + tally + '</div></div>' +
      '</section>' +
      '<p class="rule">Everyone puts down a deposit by the deadline, or nobody does. If one seat is empty when the clock hits zero, the trip is off and ' + esc(t.organizerName) + ' sends every deposit back. ' + esc(t.covers || '') + '</p>' +
      friendCard() +
      (t.isOrganizer ? organizerPanel() : '') +
      '<footer>Lock It In never touches your money. You pay ' + esc(t.organizerName) + ' directly.' + (t.isOrganizer ? '' : ' <a href="/">Start your own trip</a>') + '</footer>';
    $('app').innerHTML = html;
  }

  function friendCard() {
    var t = trip;
    var mine = t.members.filter(function (m) { return m.id === me; })[0];
    var opts = '<option value="">Pick your name</option>' + t.members.map(function (m) { return '<option value="' + esc(m.id) + '"' + (m.id === me ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('');
    var picker = '<label for="who">Who are you?</label><select id="who" data-action="pick">' + opts + '</select>';
    var body = '';

    if (t.phase === 'locked') {
      return '<section class="card"><h2>It\u2019s happening</h2><div class="done">Every seat is locked in. ' + esc(t.organizerName) + ' is booking ' + esc(t.name) + ' now.</div></section>';
    }
    if (t.phase === 'verifying') {
      return '<section class="card"><h2>Hang tight</h2><div class="waiting">Everyone said they paid in time. Once ' + esc(t.organizerName) + ' confirms the last deposits, this page will stamp LOCKED.</div></section>';
    }
    if (t.phase === 'released') {
      if (!mine) body = '<p class="note">Pick your name to see what happens to your deposit.</p>';
      else if (mine.status === 'confirmed' || mine.status === 'claimed') {
        body = mine.refunded
          ? '<div class="done">' + esc(t.organizerName) + ' marked your ' + money(t.deposit) + ' as refunded.</div>'
          : '<div class="waiting">' + esc(t.organizerName) + ' is sending your ' + money(t.deposit) + ' back' + (mine.method ? ' through ' + esc(methodLabel(mine.method)) : '') + '.</div>';
      } else if (!mine.gaveReason) body = reasonForm('What got in the way?', 'One tap helps your group plan the next trip. Only ' + esc(t.organizerName) + ' sees this.', false);
      else body = '<div class="done">Thanks. ' + esc(t.organizerName) + ' will see that.</div>';
      return '<section class="card"><h2>The trip didn\u2019t lock</h2>' + picker + body + errorLine() + '</section>';
    }

    // open
    if (!mine) body = '<p class="note">Pick your name to put down your deposit.</p>';
    else if (mine.status === 'confirmed') body = '<div class="done">You\u2019re locked in, ' + esc(mine.name) + '. Now it\u2019s on the others.</div>';
    else if (mine.status === 'claimed') {
      body = '<div class="waiting">You said you sent ' + money(t.deposit) + ' through ' + esc(methodLabel(mine.method)) + '. Your seat turns green once ' + esc(t.organizerName) + ' confirms it.</div>' +
        '<button class="linkish" data-action="unclaim">I haven\u2019t actually sent it yet</button>';
    } else if (mine.status === 'out') {
      body = '<div class="stopped">You\u2019re out. Since the trip only happens if everyone\u2019s in, ' + esc(t.organizerName) + ' may reshuffle the group.</div>' +
        '<button class="btn ghost" data-action="backin">Changed my mind, I\u2019m back in</button>';
    } else if (ui.showOut) {
      body = reasonForm('Can\u2019t make it?', 'Saying so early helps ' + esc(t.organizerName) + ' replan instead of waiting on the clock.', true) +
        '<button class="linkish" data-action="cancel-out">Never mind, I\u2019m still in</button>';
    } else {
      body = methodPicker(mine) + '<button class="linkish" data-action="show-out">I can\u2019t make it</button>';
    }
    return '<section class="card"><h2>Lock in your seat</h2>' + picker + body + errorLine() + '</section>';
  }

  function methodPicker(mine) {
    var t = trip;
    var keys = Object.keys(METHOD_INFO).filter(function (k) { return t.methods[k]; });
    if (ui.method && !t.methods[ui.method]) ui.method = null;
    if (!ui.method && keys.length === 1) ui.method = keys[0];
    var grid = '<h3>How do you want to pay ' + esc(t.organizerName) + '?</h3><div class="methods">' + keys.map(function (k) {
      return '<button class="method" data-action="method" data-method="' + k + '" aria-pressed="' + (ui.method === k) + '"><b>' + METHOD_INFO[k].label + '</b><span>' + esc(METHOD_INFO[k].sub(t.methods[k])) + '</span></button>';
    }).join('') + '</div>';
    if (!ui.method) return grid;

    var m = ui.method, h = t.methods[m], amt = money(t.deposit), link = payLink(m, mine.name), steps;
    var copyAmt = '<div class="copyrow"><code>' + esc(String(t.deposit)) + '</code><button class="btn small ghost" data-action="copy" data-text="' + esc(String(t.deposit)) + '">Copy amount</button></div>';
    var copyNote = '<div class="copyrow"><code>' + esc(payNote(mine.name)) + '</code><button class="btn small ghost" data-action="copy" data-text="' + esc(payNote(mine.name)) + '">Copy note</button></div>';
    if (m === 'venmo') steps = '<li>Tap below. Venmo opens with ' + amt + ' and the note filled in.</li><li>Send it, then come back here.</li>';
    else if (m === 'cashapp') steps = '<li>Tap below. Cash App opens to $' + esc(h) + ' with ' + amt + ' filled in.</li><li>Add this note so ' + esc(t.organizerName) + ' knows what it\u2019s for.' + copyNote + '</li>';
    else if (m === 'paypal') steps = '<li>Tap below. PayPal opens with ' + amt + ' filled in. Choose \u201cFriends and Family\u201d so there\u2019s no fee.</li><li>Add this note.' + copyNote + '</li>';
    else if (m === 'zelle') steps = '<li>Open your bank\u2019s app and go to Zelle.</li><li>Send to this email or phone.<div class="copyrow"><code>' + esc(h) + '</code><button class="btn small ghost" data-action="copy" data-text="' + esc(h) + '">Copy</button></div></li><li>Enter the amount.' + copyAmt + '</li><li>Add this memo.' + copyNote + '</li>';
    else if (m === 'applecash') steps = '<li>Open Messages and text this number.<div class="copyrow"><code>' + esc(h) + '</code><button class="btn small ghost" data-action="copy" data-text="' + esc(h) + '">Copy</button></div></li><li>Tap the Apple Cash button and send ' + amt + '.</li>';
    else steps = '<li>Hand ' + amt + ' to ' + esc(t.organizerName) + ' in person.</li><li>Tap the button below once you have.</li>';

    return grid + '<h3>Send ' + amt + ' with ' + METHOD_INFO[m].label + '</h3><ol class="steps">' + steps + '</ol>' +
      (link ? '<a class="btn ghost" href="' + esc(link) + '" target="_blank" rel="noopener">Open ' + METHOD_INFO[m].label + '</a>' : '') +
      '<button class="btn" data-action="claim">' + (m === 'cash' ? 'I handed over my ' : 'I sent my ') + amt + '</button>' +
      '<p class="note">Your seat turns yellow now and green once ' + esc(trip.organizerName) + ' confirms the money landed.</p>';
  }

  function reasonForm(title, sub, out) {
    return '<h3>' + title + '</h3><p class="note">' + sub + '</p><div class="reasons">' +
      REASONS.map(function (r) { return '<button class="btn ghost" data-action="reason" data-reason="' + r[0] + '" data-out="' + (out ? '1' : '') + '">' + r[1] + '</button>'; }).join('') +
      '</div><label for="reasonNote">Anything else? (optional)</label><input id="reasonNote" maxlength="200" placeholder="Like: any weekend in December works">';
  }
  function errorLine() { return '<div class="error" role="alert">' + esc(ui.error) + '</div>'; }

  function organizerPanel() {
    var t = trip, s = t.stats || {};
    var missing = t.members.filter(function (m) { return m.status !== 'confirmed'; });
    var groupMsg = t.name + ' is real only if all ' + t.members.length + ' of us lock in. Put down your ' + money(t.deposit) + ' deposit by ' + fmtTime(t.deadline) +
      '. If anyone is missing when the clock runs out, the trip is off and everyone gets refunded. Pick your name here: ' + friendLink();
    var nudgeMsg = missing.length
      ? clockText().replace(/ \d+s$/, '') + ' left on ' + t.name + '. Still waiting on ' + missing.map(function (m) { return m.name; }).join(', ') + '. One tap and we\u2019re booked: ' + friendLink()
      : 'Everyone is in. Booking ' + t.name + ' now!';

    var rows = t.members.map(function (m) {
      var status = { confirmed: 'Locked in', claimed: 'Says sent', open: 'Not yet', out: 'Out' }[m.status];
      var actions = '';
      if (m.status === 'confirmed') actions += '<button class="btn small ghost" data-action="unconfirm" data-id="' + m.id + '">Undo</button> ';
      else if (m.status === 'claimed') actions += '<button class="btn small" data-action="confirm" data-id="' + m.id + '">Confirm</button> ';
      else actions += '<button class="btn small ghost" data-action="confirm" data-id="' + m.id + '" title="Use this if they paid you some other way">Paid me directly</button> ';
      if (t.phase === 'released' && (m.status === 'confirmed' || m.status === 'claimed'))
        actions += '<button class="btn small ' + (m.refunded ? '' : 'ghost') + '" data-action="refund" data-id="' + m.id + '" data-value="' + (m.refunded ? '' : '1') + '">' + (m.refunded ? 'Refunded' : 'Mark refunded') + '</button> ';
      actions += '<button class="linkish" style="margin:0 0 0 4px" data-action="remove" data-id="' + m.id + '" aria-label="Remove ' + esc(m.name) + '">Remove</button>';
      return '<tr><td>' + esc(m.name) + (m.reason ? '<div class="note">' + esc(REASON_LABEL[m.reason]) + (m.reasonNote ? ': \u201c' + esc(m.reasonNote) + '\u201d' : '') + '</div>' : '') + '</td>' +
        '<td><span class="pill ' + m.status + '">' + status + '</span></td>' +
        '<td>' + (m.method ? esc(methodLabel(m.method)) : '') + (m.claimedAt ? '<div class="note">' + hoursAfterOpen(m.claimedAt) + 'h in</div>' : '') + '</td>' +
        '<td style="white-space:nowrap">' + actions + '</td></tr>';
    }).join('');

    var methodsUsed = Object.keys(s.byMethod || {}).map(function (k) { return methodLabel(k) + ' ' + s.byMethod[k]; }).join(', ') || 'None yet';
    var reasonsGiven = Object.keys(s.reasons || {}).map(function (k) { return REASON_LABEL[k] + ' (' + s.reasons[k] + ')'; }).join(', ') || 'None yet';

    return '<section class="card"><h2>Organizer view</h2><p class="note">Only you see this, because your link has the organizer key. Don\u2019t share it.</p>' +
      '<h3>Kick it off</h3><label for="groupMsg">Paste this in the group chat</label><textarea id="groupMsg" readonly>' + esc(groupMsg) + '</textarea>' +
      '<button class="btn ghost" data-action="copy" data-text="' + esc(groupMsg) + '">Copy group chat message</button>' +
      (t.phase === 'open' && missing.length ? '<h3>Nudge the holdouts</h3><textarea id="nudgeMsg" readonly>' + esc(nudgeMsg) + '</textarea><button class="btn ghost" data-action="nudge" data-text="' + esc(nudgeMsg) + '">Copy nudge</button>' : '') +
      '<h3>Confirm deposits</h3><p class="note">When money lands in your account, confirm it. A seat only turns green after you do.</p>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Friend</th><th>Status</th><th>Paid with</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="copyrow" style="margin-top:12px"><input id="newName" placeholder="Add a friend" maxlength="30" style="flex:1"><button class="btn small" data-action="add">Add</button></div>' +
      (t.phase === 'released' ? '<h3>Refund checklist</h3><p class="note">Send back every deposit, then mark it refunded so your friends see it.</p>' : '') +
      '<h3>Test results</h3><div class="statgrid">' +
        stat(s.confirmed + ' of ' + s.seats, 'locked in') +
        stat(s.within24h, 'sent within 24 hours') +
        stat(s.medianHoursToSend == null ? '\u2013' : s.medianHoursToSend + 'h', 'median time to send') +
        stat(s.hoursToLock == null ? '\u2013' : s.hoursToLock + 'h', 'time to fully lock') +
        stat(s.nudgesSent, 'nudges sent') +
        stat(s.out, 'said they\u2019re out') +
      '</div><p class="note">Paid with: ' + esc(methodsUsed) + '</p><p class="note">Why holdouts held out: ' + esc(reasonsGiven) + '</p>' +
      '<a class="btn ghost" href="/api/trips/' + encodeURIComponent(tripId) + '/export.csv?key=' + encodeURIComponent(key) + '">Download results as CSV</a>' +
      '<button class="btn ghost" data-action="restart">Restart the clock from now</button>' +
      errorLine() + '</section>';
  }
  function stat(big, small) { return '<div class="stat"><b>' + esc(big) + '</b><span>' + esc(small) + '</span></div>'; }

  // ---------- events ----------
  document.addEventListener('change', function (e) {
    if (e.target.id === 'who') {
      me = e.target.value; ui.method = null; ui.showOut = false; ui.error = '';
      try { me ? localStorage.setItem(meKey, me) : localStorage.removeItem(meKey); } catch (x) {}
      render();
    }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-action]'); if (!b || b.tagName === 'SELECT') return;
    var a = b.getAttribute('data-action'), id = b.getAttribute('data-id');
    if (a === 'method') { ui.method = b.getAttribute('data-method'); render(); return; }
    if (a === 'copy') { copy(b.getAttribute('data-text')); return; }
    if (a === 'nudge') { copy(b.getAttribute('data-text'), 'Nudge copied. Paste it in the chat.'); api('/nudge', { method: 'POST', body: {} }).catch(function () {}); return; }
    if (a === 'show-out') { ui.showOut = true; render(); return; }
    if (a === 'cancel-out') { ui.showOut = false; render(); return; }
    if (a === 'claim') { act('/claim', { memberId: me, method: ui.method }).then(function () { ui.method = null; }); return; }
    if (a === 'unclaim') { act('/unclaim', { memberId: me }); return; }
    if (a === 'backin') { act('/back-in', { memberId: me }); return; }
    if (a === 'reason') {
      var note = ($('reasonNote') || {}).value || '';
      act('/reason', { memberId: me, reason: b.getAttribute('data-reason'), note: note, out: !!b.getAttribute('data-out') }).then(function () { ui.showOut = false; });
      return;
    }
    if (a === 'confirm') { act('/confirm', { memberId: id, value: true }); return; }
    if (a === 'unconfirm') { act('/confirm', { memberId: id, value: false }); return; }
    if (a === 'refund') { act('/refund', { memberId: id, value: !!b.getAttribute('data-value') }); return; }
    if (a === 'remove') { if (confirm('Remove this person from the trip?')) act('/members/' + encodeURIComponent(id), null, 'DELETE'); return; }
    if (a === 'add') { var nm = ($('newName') || {}).value || ''; act('/members', { name: nm }); return; }
    if (a === 'restart') { if (confirm('Restart the countdown from now? Everyone keeps their seat status.')) act('/restart', {}); return; }
  });

  setInterval(function () {
    if (!trip) return;
    var c = $('clock');
    if (trip.phase === 'open' && Date.parse(trip.deadline) - now() <= 0) { load(true); return; }
    if (c) c.textContent = clockText();
  }, 1000);
  setInterval(function () {
    var typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (!typing) load(false);
  }, 5000);
  load(true);
})();
