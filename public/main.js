const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const nameInput = document.getElementById('nameInput');
const enterBattleBtn = document.getElementById('enterBattleBtn');
const lobbyOverlay = document.getElementById('lobbyOverlay');
const deadOverlay = document.getElementById('deadOverlay');
const respawnBtn = document.getElementById('respawnBtn');
const deathInfo = document.getElementById('deathInfo');

const STATE = { LOBBY: 'LOBBY', ALIVE: 'ALIVE', DEAD: 'DEAD' };

const world = { w: 5000, h: 5000 };
const tickHz = 20;
let myId = null;
let myName = '';
let uiState = STATE.LOBBY;
let ws = null;
let seq = 1;
let lockTargetId = null;

const snapshots = [];
const interpolationDelay = 120;
const chatLog = [];
const explosions = [];

const pressed = {
  up: false,
  down: false,
  left: false,
  right: false,
  gun: false,
  missile: false,
  interceptor: false,
};

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    send({ type: 'hello', name: nameInput.value.trim() || myName || '' });
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };

  ws.onclose = () => addChatLine('System', '连接已断开');
}

function handleMessage(msg) {
  if (msg.type === 'welcome') {
    myId = msg.id;
    world.w = msg.world.w;
    world.h = msg.world.h;
    myName = nameInput.value.trim();
    return;
  }

  if (msg.type === 'snapshot') {
    snapshots.push(msg);
    while (snapshots.length > 30) snapshots.shift();
    const me = msg.players.find((p) => p.id === myId);
    if (me) {
      uiState = me.state;
      syncOverlays(me, msg.t);
    }
    return;
  }

  if (msg.type === 'chat') {
    addChatLine(msg.fromName, msg.msg);
    return;
  }

  if (msg.type === 'event') {
    if (msg.event === 'death' && msg.victimId === myId) {
      addChatLine('System', `你被${msg.killerId || '未知'}击毁，原因：${msg.cause}`);
    }
    if (msg.event === 'explode') {
      explosions.push({ x: msg.at.x, y: msg.at.y, t: msg.t, kind: msg.kind });
    }
    return;
  }

  if (msg.type === 'error') {
    addChatLine('Error', `${msg.code}: ${msg.message}`);
  }
}

function syncOverlays(me, nowServerTs) {
  lobbyOverlay.classList.toggle('show', uiState === STATE.LOBBY);
  deadOverlay.classList.toggle('show', uiState === STATE.DEAD);

  if (uiState === STATE.DEAD) {
    const killerText = me.lastDeath?.killerId ? `击毁者: ${me.lastDeath.killerId}` : '击毁者: 未知';
    const causeText = me.lastDeath?.cause ? `原因: ${me.lastDeath.cause}` : '';
    deathInfo.textContent = `${killerText} ${causeText}`.trim();
    const remain = Math.max(0, me.respawnAvailableAt - nowServerTs);
    if (remain > 0) {
      respawnBtn.disabled = true;
      respawnBtn.textContent = `重生 (${Math.ceil(remain / 1000)}s)`;
    } else {
      respawnBtn.disabled = false;
      respawnBtn.textContent = '重生';
    }
  }
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

setInterval(() => {
  send({
    type: 'input',
    seq: seq++,
    pressed,
    lockTargetId,
  });
}, Math.floor(1000 / 30));

window.addEventListener('keydown', (e) => {
  if (document.activeElement === chatInput || document.activeElement === nameInput) return;
  if (e.key === 'w' || e.key === 'ArrowUp') pressed.up = true;
  if (e.key === 's' || e.key === 'ArrowDown') pressed.down = true;
  if (e.key === 'a' || e.key === 'ArrowLeft') pressed.left = true;
  if (e.key === 'd' || e.key === 'ArrowRight') pressed.right = true;
  if (e.code === 'Space') pressed.gun = true;
  if (e.key === 'Shift') pressed.missile = true;
  if (e.key.toLowerCase() === 'e') pressed.interceptor = true;

  if (e.key === 'Enter') {
    chatInput.focus();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'w' || e.key === 'ArrowUp') pressed.up = false;
  if (e.key === 's' || e.key === 'ArrowDown') pressed.down = false;
  if (e.key === 'a' || e.key === 'ArrowLeft') pressed.left = false;
  if (e.key === 'd' || e.key === 'ArrowRight') pressed.right = false;
  if (e.code === 'Space') pressed.gun = false;
  if (e.key === 'Shift') pressed.missile = false;
  if (e.key.toLowerCase() === 'e') pressed.interceptor = false;
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = chatInput.value.trim();
    if (v) send({ type: 'chat', msg: v });
    chatInput.value = '';
    chatInput.blur();
  }
  if (e.key === 'Escape') {
    chatInput.blur();
  }
});

enterBattleBtn.addEventListener('click', () => {
  myName = nameInput.value.trim();
  send({ type: 'hello', name: myName });
  send({ type: 'enter_battle' });
});

respawnBtn.addEventListener('click', () => send({ type: 'respawn' }));

canvas.addEventListener('click', (e) => {
  const { playerMap, camera } = getInterpolatedWorld(Date.now() - interpolationDelay);
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left + camera.x - canvas.width / 2;
  const my = e.clientY - rect.top + camera.y - canvas.height / 2;
  let nearest = null;
  let best = 30 * 30;
  for (const p of playerMap.values()) {
    if (p.id === myId || p.state !== STATE.ALIVE) continue;
    const dx = p.x - mx;
    const dy = p.y - my;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      nearest = p;
    }
  }
  lockTargetId = nearest ? nearest.id : null;
});

function addChatLine(from, msg) {
  chatLog.push({ from, msg });
  while (chatLog.length > 40) chatLog.shift();
  chatMessages.innerHTML = chatLog
    .map((line) => `<div class="chat-line"><b>${escapeHtml(line.from)}:</b> ${escapeHtml(line.msg)}</div>`)
    .join('');
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function getInterpolatedWorld(renderTime) {
  if (snapshots.length === 0) return { playerMap: new Map(), bullets: [], missiles: [], interceptors: [], camera: { x: 0, y: 0 } };

  let older = snapshots[0];
  let newer = snapshots[snapshots.length - 1];

  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].t <= renderTime) {
      older = snapshots[i];
      newer = snapshots[Math.min(i + 1, snapshots.length - 1)];
      break;
    }
  }

  const denom = Math.max(1, newer.t - older.t);
  const alpha = Math.max(0, Math.min(1, (renderTime - older.t) / denom));

  const olderMap = new Map(older.players.map((p) => [p.id, p]));
  const newerMap = new Map(newer.players.map((p) => [p.id, p]));
  const merged = new Map();

  for (const [id, p2] of newerMap.entries()) {
    const p1 = olderMap.get(id) || p2;
    merged.set(id, {
      ...p2,
      x: p1.x + (p2.x - p1.x) * alpha,
      y: p1.y + (p2.y - p1.y) * alpha,
      vx: p1.vx + (p2.vx - p1.vx) * alpha,
      vy: p1.vy + (p2.vy - p1.vy) * alpha,
      heading: lerpAngle(p1.heading, p2.heading, alpha),
    });
  }

  const me = merged.get(myId);
  const camera = me ? { x: me.x, y: me.y } : { x: world.w / 2, y: world.h / 2 };
  return {
    playerMap: merged,
    bullets: newer.bullets || [],
    missiles: newer.missiles || [],
    interceptors: newer.interceptors || [],
    camera,
  };
}

function render() {
  const now = Date.now();
  const { playerMap, bullets, missiles, interceptors, camera } = getInterpolatedWorld(now - interpolationDelay);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawGrid(camera);
  drawWorldBounds(camera);

  const view = {
    minX: camera.x - canvas.width / 2,
    maxX: camera.x + canvas.width / 2,
    minY: camera.y - canvas.height / 2,
    maxY: camera.y + canvas.height / 2,
  };

  for (const p of playerMap.values()) {
    if (p.x < view.minX - 50 || p.x > view.maxX + 50 || p.y < view.minY - 50 || p.y > view.maxY + 50) continue;
    drawPlane(p, camera, p.id === myId);
  }

  drawEntities(bullets, camera, '#fce94f', 2, view);
  drawEntities(missiles, camera, '#ff7066', 4, view);
  drawEntities(interceptors, camera, '#66f2ff', 4, view);

  drawExplosions(camera, now);

  const me = playerMap.get(myId);
  if (me) {
    const speed = Math.hypot(me.vx, me.vy).toFixed(1);
    hud.innerHTML = `玩家: ${escapeHtml(me.name)}<br>状态: ${me.state}<br>坐标: (${me.x.toFixed(1)}, ${me.y.toFixed(1)})<br>速度: ${speed}<br>血量: ${me.hp}<br>锁定目标: ${lockTargetId || '无'}`;
  } else {
    hud.innerHTML = '等待服务器快照...';
  }

  drawMiniMap(playerMap, camera);
  requestAnimationFrame(render);
}

function drawPlane(p, camera, isSelf) {
  const sx = p.x - camera.x + canvas.width / 2;
  const sy = p.y - camera.y + canvas.height / 2;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(p.heading + Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(11, 11);
  ctx.lineTo(-11, 11);
  ctx.closePath();
  ctx.fillStyle = isSelf ? '#50e3a4' : '#56a0ff';
  if (Date.now() < (p.invulnUntil || 0)) ctx.fillStyle = '#ffe066';
  ctx.fill();
  if (p.id === lockTargetId) {
    ctx.strokeStyle = '#ff2f68';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = '#fff';
  ctx.font = '12px Arial';
  ctx.fillText(`${p.name} [${p.hp}]`, sx - 28, sy - 20);
}

function drawEntities(list, camera, color, radius, view) {
  ctx.fillStyle = color;
  for (const e of list) {
    if (e.x < view.minX - 20 || e.x > view.maxX + 20 || e.y < view.minY - 20 || e.y > view.maxY + 20) continue;
    const sx = e.x - camera.x + canvas.width / 2;
    const sy = e.y - camera.y + canvas.height / 2;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGrid(camera) {
  const gap = 200;
  const offsetX = -(camera.x % gap);
  const offsetY = -(camera.y % gap);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;

  for (let x = offsetX; x < canvas.width; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = offsetY; y < canvas.height; y += gap) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function drawWorldBounds(camera) {
  const x = -camera.x + canvas.width / 2;
  const y = -camera.y + canvas.height / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.strokeRect(x, y, world.w, world.h);
}

function drawExplosions(camera, now) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const ex = explosions[i];
    const age = now - ex.t;
    if (age > 450) {
      explosions.splice(i, 1);
      continue;
    }
    const t = age / 450;
    const r = 6 + t * 30;
    const alpha = 1 - t;
    const sx = ex.x - camera.x + canvas.width / 2;
    const sy = ex.y - camera.y + canvas.height / 2;
    ctx.strokeStyle = `rgba(255, 140, 90, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawMiniMap(playerMap, camera) {
  const w = 180;
  const h = 180;
  const pad = 14;
  const x0 = canvas.width - w - pad;
  const y0 = canvas.height - h - pad;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(x0, y0, w, h);

  for (const p of playerMap.values()) {
    if (p.state !== STATE.ALIVE) continue;
    const px = x0 + (p.x / world.w) * w;
    const py = y0 + (p.y / world.h) * h;
    ctx.fillStyle = p.id === myId ? '#50e3a4' : '#7fb3ff';
    ctx.fillRect(px - 2, py - 2, 4, 4);
  }

  const camX = x0 + (camera.x / world.w) * w;
  const camY = y0 + (camera.y / world.h) * h;
  ctx.strokeStyle = '#ffd166';
  ctx.strokeRect(camX - 4, camY - 4, 8, 8);
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

connect();
render();
addChatLine('System', '欢迎来到多人飞行战场');
addChatLine('System', '控制：WASD/方向键、Space机炮、Shift导弹、E拦截弹');
