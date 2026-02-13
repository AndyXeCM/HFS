const CONFIG = {
  PORT: 52743,
  TICK_HZ: 20,
  TICK_MS: 50,
  WORLD_W: 5000,
  WORLD_H: 5000,
  PLAYER_RADIUS: 18,
  PLAYER_MAX_HP: 100,
  PLAYER_MAX_SPEED: 420,
  PLAYER_THRUST: 340,
  PLAYER_TURN_RATE: 2.8,
  PLAYER_BRAKE_FACTOR: 0.9,
  PLAYER_DRAG: 0.99,
  RESPAWN_COOLDOWN_MS: 3000,
  RESPAWN_INVULN_MS: 2000,
  BULLET_SPEED: 720,
  BULLET_DAMAGE: 5,
  BULLET_RADIUS: 2,
  BULLET_TTL_MS: 800,
  GUN_COOLDOWN_MS: 100,
  MISSILE_SPEED: 450,
  MISSILE_TURN_RATE: 3.0,
  MISSILE_DAMAGE: 40,
  MISSILE_RADIUS: 6,
  MISSILE_TTL_MS: 6000,
  MISSILE_COOLDOWN_MS: 1000,
  INTERCEPTOR_SPEED: 500,
  INTERCEPTOR_RADIUS: 5,
  INTERCEPTOR_TTL_MS: 1500,
  INTERCEPTOR_COOLDOWN_MS: 800,
};

const PLAYER_STATE = {
  LOBBY: 'LOBBY',
  ALIVE: 'ALIVE',
  DEAD: 'DEAD',
};

const ENTITY_TYPE = {
  BULLET: 'bullet',
  MISSILE: 'missile',
  INTERCEPTOR: 'interceptor',
};

class Game {
  constructor() {
    this.players = new Map();
    this.inputs = new Map();
    this.bullets = [];
    this.missiles = [];
    this.interceptors = [];
    this.connections = new Map();
    this.lastTickTs = Date.now();
    this._nextEntitySeq = 1;
  }

  addConnection(id, ws, name) {
    const playerName = sanitizeName(name) || `Guest${id.slice(-4)}`;
    const now = Date.now();
    this.connections.set(id, ws);
    this.players.set(id, {
      id,
      name: playerName,
      type: 'player',
      state: PLAYER_STATE.LOBBY,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: CONFIG.PLAYER_RADIUS,
      heading: -Math.PI / 2,
      hp: CONFIG.PLAYER_MAX_HP,
      alive: true,
      lastFireTs: 0,
      lastMissileTs: 0,
      lastInterceptorTs: 0,
      invulnUntil: 0,
      respawnAvailableAt: now,
      lockedTargetId: null,
      lastDeath: null,
    });

    this.inputs.set(id, defaultInput());
  }

  removeConnection(id) {
    this.connections.delete(id);
    this.players.delete(id);
    this.inputs.delete(id);
    this.bullets = this.bullets.filter((b) => b.ownerId !== id);
    this.missiles = this.missiles.filter((m) => m.ownerId !== id);
    this.interceptors = this.interceptors.filter((i) => i.ownerId !== id);
  }

  setPlayerName(id, name) {
    const p = this.players.get(id);
    if (!p) return;
    p.name = sanitizeName(name) || p.name;
  }

  enterBattle(id) {
    const p = this.players.get(id);
    if (!p) return { ok: false, code: 'NOT_FOUND', message: 'Player not found' };
    if (p.state === PLAYER_STATE.ALIVE) {
      return { ok: false, code: 'BAD_STATE', message: 'Already in battle' };
    }
    if (p.state === PLAYER_STATE.DEAD) {
      return { ok: false, code: 'BAD_STATE', message: 'Use respawn while dead' };
    }
    this.spawnPlayer(p);
    return { ok: true };
  }

  respawn(id) {
    const p = this.players.get(id);
    if (!p) return { ok: false, code: 'NOT_FOUND', message: 'Player not found' };
    if (p.state !== PLAYER_STATE.DEAD) {
      return { ok: false, code: 'BAD_STATE', message: 'Player not in DEAD state' };
    }
    const now = Date.now();
    if (now < p.respawnAvailableAt) {
      return {
        ok: false,
        code: 'RESPAWN_COOLDOWN',
        message: `Respawn cooldown: ${Math.ceil((p.respawnAvailableAt - now) / 1000)}s`,
      };
    }
    this.spawnPlayer(p);
    return { ok: true };
  }

  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    const prior = this.inputs.get(id) || defaultInput();
    this.inputs.set(id, {
      seq: Number.isFinite(msg.seq) ? msg.seq : prior.seq,
      pressed: {
        up: !!msg.pressed?.up,
        down: !!msg.pressed?.down,
        left: !!msg.pressed?.left,
        right: !!msg.pressed?.right,
        gun: !!msg.pressed?.gun,
        missile: !!msg.pressed?.missile,
        interceptor: !!msg.pressed?.interceptor,
      },
      lockTargetId: msg.lockTargetId || prior.lockTargetId || null,
    });
    if (msg.lockTargetId !== undefined) {
      p.lockedTargetId = msg.lockTargetId || null;
    }
  }

  spawnPlayer(player) {
    const spawn = randomSpawn();
    player.state = PLAYER_STATE.ALIVE;
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.heading = spawn.heading;
    player.hp = CONFIG.PLAYER_MAX_HP;
    player.alive = true;
    player.invulnUntil = Date.now() + CONFIG.RESPAWN_INVULN_MS;
    player.lastDeath = null;
  }

  tick() {
    const now = Date.now();
    const dtSec = CONFIG.TICK_MS / 1000;
    this.lastTickTs = now;

    for (const [id, p] of this.players.entries()) {
      if (p.state !== PLAYER_STATE.ALIVE) continue;
      const input = this.inputs.get(id) || defaultInput();
      this.applyPlayerInput(p, input, dtSec, now);
    }

    this.stepProjectiles(this.bullets, dtSec);
    this.stepProjectiles(this.interceptors, dtSec);
    this.stepMissiles(dtSec);

    this.handleCollisions(now);

    this.trimByTTL(this.bullets, now);
    this.trimByTTL(this.missiles, now);
    this.trimByTTL(this.interceptors, now);

    this.broadcastSnapshot(now);
  }

  applyPlayerInput(p, input, dtSec, now) {
    const press = input.pressed;
    if (press.left) p.heading -= CONFIG.PLAYER_TURN_RATE * dtSec;
    if (press.right) p.heading += CONFIG.PLAYER_TURN_RATE * dtSec;

    const dirX = Math.cos(p.heading);
    const dirY = Math.sin(p.heading);

    if (press.up) {
      p.vx += dirX * CONFIG.PLAYER_THRUST * dtSec;
      p.vy += dirY * CONFIG.PLAYER_THRUST * dtSec;
    }
    if (press.down) {
      p.vx *= CONFIG.PLAYER_BRAKE_FACTOR;
      p.vy *= CONFIG.PLAYER_BRAKE_FACTOR;
    }

    p.vx *= CONFIG.PLAYER_DRAG;
    p.vy *= CONFIG.PLAYER_DRAG;

    const speed = Math.hypot(p.vx, p.vy);
    if (speed > CONFIG.PLAYER_MAX_SPEED) {
      const scale = CONFIG.PLAYER_MAX_SPEED / speed;
      p.vx *= scale;
      p.vy *= scale;
    }

    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    this.clampToWorld(p);

    if (press.gun && now - p.lastFireTs >= CONFIG.GUN_COOLDOWN_MS) {
      p.lastFireTs = now;
      this.fireBullet(p, now);
    }
    if (press.missile && now - p.lastMissileTs >= CONFIG.MISSILE_COOLDOWN_MS) {
      p.lastMissileTs = now;
      this.fireMissile(p, now);
    }
    if (press.interceptor && now - p.lastInterceptorTs >= CONFIG.INTERCEPTOR_COOLDOWN_MS) {
      p.lastInterceptorTs = now;
      this.fireInterceptor(p, now);
    }
  }

  fireBullet(p, now) {
    const dirX = Math.cos(p.heading);
    const dirY = Math.sin(p.heading);
    this.bullets.push({
      id: this.nextEntityId(ENTITY_TYPE.BULLET),
      type: ENTITY_TYPE.BULLET,
      ownerId: p.id,
      x: p.x + dirX * (p.radius + 4),
      y: p.y + dirY * (p.radius + 4),
      vx: dirX * CONFIG.BULLET_SPEED + p.vx,
      vy: dirY * CONFIG.BULLET_SPEED + p.vy,
      radius: CONFIG.BULLET_RADIUS,
      damage: CONFIG.BULLET_DAMAGE,
      alive: true,
      ttl: now + CONFIG.BULLET_TTL_MS,
    });
  }

  fireMissile(p, now) {
    const dirX = Math.cos(p.heading);
    const dirY = Math.sin(p.heading);
    this.missiles.push({
      id: this.nextEntityId(ENTITY_TYPE.MISSILE),
      type: ENTITY_TYPE.MISSILE,
      ownerId: p.id,
      targetId: this.pickMissileTarget(p),
      x: p.x + dirX * (p.radius + 8),
      y: p.y + dirY * (p.radius + 8),
      vx: dirX * CONFIG.MISSILE_SPEED + p.vx * 0.3,
      vy: dirY * CONFIG.MISSILE_SPEED + p.vy * 0.3,
      speed: CONFIG.MISSILE_SPEED,
      turnRate: CONFIG.MISSILE_TURN_RATE,
      damage: CONFIG.MISSILE_DAMAGE,
      radius: CONFIG.MISSILE_RADIUS,
      alive: true,
      ttl: now + CONFIG.MISSILE_TTL_MS,
    });
  }

  fireInterceptor(p, now) {
    const dirX = Math.cos(p.heading);
    const dirY = Math.sin(p.heading);
    this.interceptors.push({
      id: this.nextEntityId(ENTITY_TYPE.INTERCEPTOR),
      type: ENTITY_TYPE.INTERCEPTOR,
      ownerId: p.id,
      x: p.x + dirX * (p.radius + 7),
      y: p.y + dirY * (p.radius + 7),
      vx: dirX * CONFIG.INTERCEPTOR_SPEED + p.vx * 0.2,
      vy: dirY * CONFIG.INTERCEPTOR_SPEED + p.vy * 0.2,
      radius: CONFIG.INTERCEPTOR_RADIUS,
      alive: true,
      ttl: now + CONFIG.INTERCEPTOR_TTL_MS,
    });
  }

  pickMissileTarget(p) {
    if (p.lockedTargetId) {
      const locked = this.players.get(p.lockedTargetId);
      if (locked && locked.state === PLAYER_STATE.ALIVE && locked.id !== p.id) return locked.id;
    }

    let nearest = null;
    let minDist = Infinity;
    for (const target of this.players.values()) {
      if (target.id === p.id || target.state !== PLAYER_STATE.ALIVE) continue;
      const d = distSq(p, target);
      if (d < minDist) {
        minDist = d;
        nearest = target;
      }
    }
    return nearest?.id || null;
  }

  stepProjectiles(arr, dtSec) {
    for (const p of arr) {
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      this.clampToWorld(p);
    }
  }

  stepMissiles(dtSec) {
    for (const m of this.missiles) {
      const target = m.targetId ? this.players.get(m.targetId) : null;
      if (target && target.state === PLAYER_STATE.ALIVE) {
        const desired = Math.atan2(target.y - m.y, target.x - m.x);
        let cur = Math.atan2(m.vy, m.vx);
        cur = rotateToward(cur, desired, m.turnRate * dtSec);
        m.vx = Math.cos(cur) * m.speed;
        m.vy = Math.sin(cur) * m.speed;
      }
      m.x += m.vx * dtSec;
      m.y += m.vy * dtSec;
      this.clampToWorld(m);
    }
  }

  handleCollisions(now) {
    for (const b of this.bullets) {
      if (!b.alive) continue;
      for (const p of this.players.values()) {
        if (!isDamageablePlayer(p, b.ownerId, now)) continue;
        if (collides(b, p)) {
          b.alive = false;
          this.applyDamage({ target: p, byId: b.ownerId, damage: b.damage, cause: 'bullet', now });
          break;
        }
      }
    }

    for (const m of this.missiles) {
      if (!m.alive) continue;
      for (const p of this.players.values()) {
        if (!isDamageablePlayer(p, m.ownerId, now)) continue;
        if (collides(m, p)) {
          m.alive = false;
          this.broadcastEvent({
            type: 'event',
            event: 'explode',
            kind: 'missile',
            at: { x: m.x, y: m.y },
            t: now,
          });
          this.applyDamage({ target: p, byId: m.ownerId, damage: m.damage, cause: 'missile', now });
          break;
        }
      }
    }

    for (const i of this.interceptors) {
      if (!i.alive) continue;
      for (const m of this.missiles) {
        if (!m.alive || m.ownerId === i.ownerId) continue;
        if (collides(i, m)) {
          i.alive = false;
          m.alive = false;
          this.broadcastEvent({
            type: 'event',
            event: 'explode',
            kind: 'interceptor',
            at: { x: i.x, y: i.y },
            t: now,
          });
          break;
        }
      }
    }

    this.bullets = this.bullets.filter((e) => e.alive);
    this.missiles = this.missiles.filter((e) => e.alive);
    this.interceptors = this.interceptors.filter((e) => e.alive);
  }

  applyDamage({ target, byId, damage, cause, now }) {
    target.hp = Math.max(0, target.hp - damage);

    this.broadcastEvent({
      type: 'event',
      event: 'hit',
      targetId: target.id,
      byId,
      damage,
      hpLeft: target.hp,
      cause,
      t: now,
    });

    if (target.hp <= 0 && target.state === PLAYER_STATE.ALIVE) {
      target.state = PLAYER_STATE.DEAD;
      target.vx = 0;
      target.vy = 0;
      target.alive = false;
      target.respawnAvailableAt = now + CONFIG.RESPAWN_COOLDOWN_MS;
      target.lastDeath = { killerId: byId, cause, t: now };
      this.broadcastEvent({
        type: 'event',
        event: 'death',
        victimId: target.id,
        killerId: byId,
        cause,
        at: { x: target.x, y: target.y },
        t: now,
      });
    }
  }

  clampToWorld(e) {
    if (e.x < 0) {
      e.x = 0;
      e.vx *= 0.5;
    } else if (e.x > CONFIG.WORLD_W) {
      e.x = CONFIG.WORLD_W;
      e.vx *= 0.5;
    }

    if (e.y < 0) {
      e.y = 0;
      e.vy *= 0.5;
    } else if (e.y > CONFIG.WORLD_H) {
      e.y = CONFIG.WORLD_H;
      e.vy *= 0.5;
    }
  }

  trimByTTL(arr, now) {
    for (const e of arr) {
      if (now >= e.ttl) e.alive = false;
    }
    let i = arr.length;
    while (i--) {
      if (!arr[i].alive) arr.splice(i, 1);
    }
  }

  broadcastChat(fromId, msg) {
    const from = this.players.get(fromId);
    if (!from) return;
    const payload = {
      type: 'chat',
      fromId,
      fromName: from.name,
      msg: String(msg || '').slice(0, 200),
      t: Date.now(),
    };
    this.broadcast(payload);
  }

  broadcastSnapshot(now) {
    const payload = {
      type: 'snapshot',
      t: now,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        state: p.state,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        heading: p.heading,
        hp: p.hp,
        invulnUntil: p.invulnUntil,
        respawnAvailableAt: p.respawnAvailableAt,
        lastDeath: p.lastDeath,
      })),
      bullets: this.bullets.map(minifyEntity),
      missiles: this.missiles.map((m) => ({ ...minifyEntity(m), targetId: m.targetId })),
      interceptors: this.interceptors.map(minifyEntity),
    };
    this.broadcast(payload);
  }

  broadcastEvent(payload) {
    this.broadcast(payload);
  }

  broadcast(msg) {
    const raw = JSON.stringify(msg);
    for (const ws of this.connections.values()) {
      if (ws.readyState === 1) ws.send(raw);
    }
  }

  sendTo(id, msg) {
    const ws = this.connections.get(id);
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(msg));
  }

  nextEntityId(prefix) {
    return `${prefix}_${this._nextEntitySeq++}`;
  }
}

function minifyEntity(e) {
  return {
    id: e.id,
    type: e.type,
    ownerId: e.ownerId,
    x: e.x,
    y: e.y,
    vx: e.vx,
    vy: e.vy,
    radius: e.radius,
    alive: e.alive,
    ttl: e.ttl,
  };
}

function sanitizeName(v) {
  if (!v) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, 24);
}

function defaultInput() {
  return {
    seq: 0,
    pressed: {
      up: false,
      down: false,
      left: false,
      right: false,
      gun: false,
      missile: false,
      interceptor: false,
    },
    lockTargetId: null,
  };
}

function randomSpawn() {
  const m = 250;
  return {
    x: m + Math.random() * (CONFIG.WORLD_W - m * 2),
    y: m + Math.random() * (CONFIG.WORLD_H - m * 2),
    heading: Math.random() * Math.PI * 2,
  };
}

function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function collides(a, b) {
  const rr = (a.radius || 0) + (b.radius || 0);
  return distSq(a, b) < rr * rr;
}

function rotateToward(current, target, maxStep) {
  let delta = normalizeAngle(target - current);
  if (delta > maxStep) delta = maxStep;
  if (delta < -maxStep) delta = -maxStep;
  return normalizeAngle(current + delta);
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function isDamageablePlayer(p, ownerId, now) {
  if (p.state !== PLAYER_STATE.ALIVE) return false;
  if (p.id === ownerId) return false;
  if (now < p.invulnUntil) return false;
  return true;
}

module.exports = {
  Game,
  CONFIG,
  PLAYER_STATE,
};
