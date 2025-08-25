
const api = {
  init: () => fetch('/captcha/init').then(r => r.json()),
  verify: (payload) =>
    fetch('/captcha/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json()),
};

const S = {
  challenge: null,
  startedAt: performance.now(),
  lastMoveAt: performance.now(),
  points: [],
  moveCount: 0,
  pathLen: 0,
  lastX: null,
  lastY: null,
  lastT: null,
  speeds: [],
  angles: [],
  jitterCount: 0,
  idleEvents: 0,
  scrollEvents: 0,
  keyEvents: 0,
  keyT: [],
  focusChanges: 0,
  blurs: 0,
  touchEvents: 0,
  puzzleOK: false,
};

const $go = document.getElementById('goBtn');
const $status = document.getElementById('status');
const $last = document.getElementById('lastResult');
const $debug = document.getElementById('debug');
const $debugToggle = document.getElementById('debugToggle');
const $metrics = document.getElementById('metrics');
const $log = document.getElementById('log');
const $challengeInfo = document.getElementById('challengeInfo');
const $puzzleModal = document.getElementById('puzzleModal');

function log(...args) {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  $log.textContent = `${$log.textContent}\n${line}`.trim();
  $log.scrollTop = $log.scrollHeight;
}
function chip(label, v) {
  const d = document.createElement('div');
  d.className = 'chip';
  d.textContent = `${label}: ${v}`;
  $metrics.appendChild(d);
}
function setStatus(text, good=false, bad=false) {
  $status.innerHTML = `<span class="dot"></span>${text}`;
  if (good) $last.innerHTML = `<span class="ok">${text}</span>`;
  else if (bad) $last.innerHTML = `<span class="err">${text}</span>`;
}

$debugToggle.addEventListener('click', () => {
  $debug.classList.toggle('open');
});

function onMoveLike(t, x, y) {
  if (S.lastX !== null) {
    const dx = x - S.lastX, dy = y - S.lastY;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1, t - S.lastT);
    const speed = dist / dt;
    S.pathLen += dist;
    S.speeds.push(speed);
    S.angles.push(Math.atan2(dy, dx));
    if (dist < 2) S.jitterCount++;
    if (t - S.lastMoveAt > 160) S.idleEvents++;
  }
  S.points.push({ x, y, t });
  S.lastX = x; S.lastY = y; S.lastT = t; S.lastMoveAt = t;
  S.moveCount++;
}
function initListeners() {
  window.addEventListener('mousemove', (e) => onMoveLike(performance.now(), e.clientX, e.clientY), { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches[0]) {
      onMoveLike(performance.now(), e.touches[0].clientX, e.touches[0].clientY);
      S.touchEvents++;
    }
  }, { passive: true });
  window.addEventListener('scroll', () => S.scrollEvents++, { passive: true });
  window.addEventListener('keydown', () => { S.keyEvents++; S.keyT.push(performance.now()); });
  window.addEventListener('focus', () => S.focusChanges++);
  window.addEventListener('blur', () => S.blurs++);
}

function directionEntropy(angles) {
  if (!angles.length) return 0;
  const bins = new Array(12).fill(0);
  for (const a of angles) {
    let idx = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 12);
    idx = Math.max(0, Math.min(11, idx));
    bins[idx]++;
  }
  const total = angles.length;
  let H = 0;
  for (const c of bins) if (c) { const p = c / total; H += -p * Math.log2(p); }
  return H;
}
function buildFeatures() {
  const avgSpeed = S.speeds.length ? (S.speeds.reduce((a, b) => a + b, 0) / S.speeds.length) : 0;
  const maxSpeed = S.speeds.length ? Math.max(...S.speeds) : 0;

  let keyH = 0;
  if (S.keyT.length > 2) {
    const gaps = [];
    for (let i = 1; i < S.keyT.length; i++) gaps.push(S.keyT[i] - S.keyT[i - 1]);
    const bins = new Array(8).fill(0);
    const min = Math.min(...gaps), max = Math.max(...gaps);
    const span = Math.max(1, max - min);
    for (const g of gaps) bins[Math.min(7, Math.floor(8 * (g - min) / span))]++;
    const total = gaps.length;
    for (const c of bins) if (c) { const p = c / total; keyH += -p * Math.log2(p); }
  }

  const f = {
    move_count: S.moveCount,
    path_length: Math.round(S.pathLen),
    avg_speed: avgSpeed,
    max_speed: maxSpeed,
    dir_entropy: directionEntropy(S.angles),
    jitter_ratio: S.moveCount ? S.jitterCount / S.moveCount : 0,
    idle_events: S.idleEvents,
    scroll_events: S.scrollEvents,
    key_events: S.keyEvents,
    key_interval_entropy: keyH,
    focus_changes: S.focusChanges,
    window_blurs: S.blurs,
    touch_events: S.touchEvents,
  };

  $metrics.innerHTML = '';
  Object.entries({
    moves: f.move_count,
    'path px': f.path_length,
    'avg v': f.avg_speed.toFixed(3),
    'max v': f.max_speed.toFixed(3),
    'dir H': f.dir_entropy.toFixed(2),
    jitter: f.jitter_ratio.toFixed(3),
    idle: f.idle_events,
    scroll: f.scroll_events,
    keys: f.key_events,
  }).forEach(([k, v]) => chip(k, v));

  return f;
}

async function findNonce(prefixHex, difficultyBits) {
  const enc = new TextEncoder();
  const prefix = new Uint8Array(prefixHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  let n = 0;
  while (true) {
    const nonceStr = String(n);
    const buf = new Uint8Array(prefix.length + nonceStr.length);
    buf.set(prefix, 0);
    buf.set(enc.encode(nonceStr), prefix.length);
    const h = await crypto.subtle.digest('SHA-256', buf);
    const view = new Uint8Array(h);
    let zeros = 0;
    for (let i = 0; i < view.length; i++) {
      const b = view[i];
      if (b === 0) { zeros += 8; continue; }
      for (let j = 7; j >= 0; j--) {
        if (((b >> j) & 1) === 0) zeros++;
        else { i = view.length; break; }
      }
      break;
    }
    if (zeros >= difficultyBits) return nonceStr;
    n++;
  }
}

function initPuzzle() {
  const canvas = document.getElementById('puzzleCanvas');
  const ctx = canvas.getContext('2d');
  const target = { x: 240, y: 70, r: 18 };
  const start = { x: 80, y: 70, r: 10 };
  let dragging = false;
  function draw(dotX = start.x, dotY = start.y) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath(); ctx.arc(target.x, target.y, target.r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#2c6cf6'; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.arc(dotX, dotY, start.r, 0, Math.PI * 2);
    ctx.fillStyle = '#48d597'; ctx.fill();
  }
  draw();
  function isInside(x, y, cx, cy, r) { return Math.hypot(x - cx, y - cy) <= r; }
  canvas.addEventListener('mousedown', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (isInside(x, y, start.x, start.y, start.r + 6)) dragging = true;
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const r = canvas.getBoundingClientRect();
    draw(e.clientX - r.left, e.clientY - r.top);
  });
  window.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (isInside(x, y, target.x, target.y, target.r)) {
      S.puzzleOK = true;
      $puzzleModal.classList.remove('open');
      setStatus('puzzle solved. tap verify again.', true, false);
      log('puzzle: ok');
    } else {
      draw();
    }
  });
}

async function init() {
  initListeners();
  initPuzzle();

  const res = await api.init();
  S.challenge = res;
  $challengeInfo.textContent = `cid=${res.challenge_id.slice(0,8)}… diff=${res.difficulty}`;
  log('init:', res);
}
init();

$go.addEventListener('click', async () => {
  try {
    $go.disabled = true;
    setStatus('verifiing');
    const f = buildFeatures();
    log('features:', f);

    const nonce = await findNonce(S.challenge.prefix, S.challenge.difficulty);
    log('pow nonce:', nonce);

    const payload = {
      challenge_id: S.challenge.challenge_id,
      client_nonce: nonce,
      features: f,
      puzzle_ok: S.puzzleOK,
    };
    const vr = await api.verify(payload);
    log('verify resp:', vr);

    if (vr.ok) {
      setStatus(`verified captcha | risk: ${vr.risk.toFixed(2)}`, true, false);
      sessionStorage.setItem('captcha_token', vr.token);
    } else {
      setStatus(`step up required | risk: ${vr.risk.toFixed(2)}`, false, true);
      $puzzleModal.classList.add('open');
    }
  } catch (e) {
    log('error:', e);
    setStatus('verification failed. check debug.', false, true);
  } finally {
    $go.disabled = false;
  }
});
