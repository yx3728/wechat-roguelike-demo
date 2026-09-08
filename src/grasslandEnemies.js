/** 草原敌群围绕草丛、同伴和玩家行动决策；没有通用扇形射击。 */
const { W, H } = require("./config.js");
const { plantCover, plantRootBud, plantVine } = require("./grasslandMechanics.js");
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function stepFor(dt) { return Math.min(3, Math.max(0, dt) / 16.667); }
function center(e) { return { x: e.x + e.w / 2, y: e.y + e.h / 2 }; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function liveCover(state) { return (state.grassCover || []).filter((c) => c && c.active !== false && c.hp > 0); }
function nearest(items, point) { return items.reduce((best, item) => !best || distance(item, point) < distance(best, point) ? item : best, null); }
function observedPlayer(e, state) {
  if (state.player && !state.grassConcealed) e.grassLastSeenPlayer = center(state.player);
  return e.grassLastSeenPlayer || { x: W / 2, y: H * 0.65 };
}
function toward(e, target, amount) {
  const c = center(e), dx = target.x - c.x, dy = target.y - c.y, d = Math.hypot(dx, dy);
  if (d <= amount) { e.x = target.x - e.w / 2; e.y = target.y - e.h / 2; return true; }
  e.x += dx / d * amount; e.y += dy / d * amount; return false;
}
function bounded(e, p) { return { x: clamp(p.x, e.w / 2 + 6, W - e.w / 2 - 6), y: clamp(p.y, 120, H - e.h / 2 - 24) }; }
function quadratic(a, b, c, t) { const u = 1 - t; return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y }; }
function create(type, level, options) {
  const hp = (options.hp + Math.floor(Math.max(1, Number(level) || 1) / (options.hpGrowth || 4))) * 1000;
  return Object.assign({ type, isGrassland: true, x: 12 + Math.random() * Math.max(1, W - options.w - 24),
    y: -options.h - 12, vx: 0, speed: 1, exp: 8, coin: 1, grassAge: 0, grassPulse: 0,
    grassAttackPhase: "approach", grassWarnProgress: 0, grassAimAngle: Math.PI / 2,
    grassTarget: null, grassTimer: 0, fireCooldown: 1600, neverFires: true,
  }, options, { hp, maxHp: hp });
}
function createMeadowHare(level) {
  return create("meadowHare", level, { color: "#e9d4a1", w: 25, h: 29, hp: 1, speed: 1.3, grassDodgeCooldown: 0, grassDodgeDir: 1 });
}
function createBladeMantis(level) {
  return create("bladeMantis", level, { color: "#b6d976", w: 29, h: 34, hp: 2, hpGrowth: 3, speed: 1.8, exp: 10, grassHideAlpha: 1, grassAmbushes: 0 });
}
function createLanternBeetle(level) {
  return create("lanternBeetle", level, { color: "#f6c65f", w: 35, h: 32, hp: 3, hpGrowth: 2, speed: 0.9,
    grassShellOpen: false, grassHoldY: H * 0.26, exp: 26, coin: 4 });
}
function createThornBloom(level) {
  return create("thornBloom", level, { color: "#e6a0bc", w: 32, h: 36, hp: 3, hpGrowth: 3, speed: 1.1,
    grassHoldY: H * (0.27 + Math.random() * 0.13), grassRootCooldown: 600, grassBudRefs: [], exp: 16, coin: 2 });
}
function createGaleFalcon(level) {
  const left = Math.random() < 0.5;
  return create("galeFalcon", level, { color: "#e7eced", w: 34, h: 23, hp: 1, hpGrowth: 3,
    x: left ? -46 : W + 12, y: H * 0.35, vx: left ? 1 : -1, speed: 3.2,
    grassOrbitRadius: 90 + Math.random() * 40, grassSwoops: 0, grassFeatherPending: 0, exp: 9 });
}
function createThunderBison(level) {
  const e = create("thunderBison", level, { color: "#b9a07d", w: 62, h: 58, hp: 50,
    speed: 1.8, grassGuardTimer: 4800, grassGuardActive: false, exp: 44, coin: 9, isElite: true });
  e.hp = e.maxHp = (50 + Math.floor(Math.max(1, Number(level) || 1) * 0.7)) * 1000; return e;
}

function incomingBullet(e, state) {
  const c = center(e);
  return (state.bullets || []).find((b) => {
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return false;
    const bx = b.x + (b.w || 6) / 2, by = b.y + (b.h || 10) / 2;
    const vx = b.vx || 0, vy = b.vy || 0, speedSq = vx * vx + vy * vy;
    if (speedSq < 0.1 || Math.hypot(c.x - bx, c.y - by) > 175) return false;
    const t = ((c.x - bx) * vx + (c.y - by) * vy) / speedSq;
    return t > 0 && t < 24 && Math.hypot(c.x - bx - vx * t, c.y - by - vy * t) < e.w / 2 + (b.w || 6) / 2 + 10;
  });
}
function updateHare(e, dt, state) {
  const step = stepFor(dt), c = center(e);
  e.grassDodgeCooldown = Math.max(0, e.grassDodgeCooldown - dt);
  const threat = e.grassDodgeCooldown <= 0 && e.y > 80 ? incomingBullet(e, state) : null;
  if (threat && e.grassAttackPhase !== "dodge") {
    let dir = c.x < threat.x + (threat.w || 6) / 2 ? -1 : 1;
    if (c.x < 75) dir = 1; if (c.x > W - 75) dir = -1;
    const cover = nearest(liveCover(state).filter((clump) => (clump.x - c.x) * dir > 22 && Math.abs(clump.y - c.y) < 150), c);
    e.grassDodgeDir = dir; e.grassAttackPhase = "dodge"; e.grassTimer = 460;
    e.grassTarget = bounded(e, cover || { x: c.x + dir * 95, y: c.y + 50 });
    e.grassDodgeCooldown = 1800; e.grassSeedPoint = { x: c.x, y: c.y + 20 };
  }
  if (e.grassAttackPhase === "dodge") {
    e.grassTimer -= dt; e.grassHop = Math.sin(Math.PI * clamp(1 - e.grassTimer / 460, 0, 1));
    if (toward(e, e.grassTarget, 5.3 * step) || e.grassTimer <= 0) {
      e.grassAttackPhase = "flee"; e.grassTimer = 950;
      plantCover(state, e.grassSeedPoint.x, e.grassSeedPoint.y);
    }
  } else {
    e.grassTimer -= dt; e.grassHop = (Math.sin(e.grassAge * 0.012) + 1) / 2;
    e.y += (e.grassAttackPhase === "flee" || e.grassAge > 9000 ? 2.8 : e.speed) * step;
    e.x += Math.sin(e.grassAge * 0.004) * 0.35 * step;
    if (e.grassAttackPhase === "flee" && e.grassTimer <= 0) e.grassAttackPhase = "scout";
  }
}
function seekCover(e, state) {
  const c = center(e);
  e.grassCoverTarget = nearest(liveCover(state), c);
  e.grassTarget = e.grassCoverTarget || bounded(e, { x: W * (c.x < W / 2 ? 0.25 : 0.75), y: H * 0.48 });
}
function prepareMantis(e, state) {
  const p = observedPlayer(e, state), c = center(e), side = c.x < p.x ? 1 : -1;
  e.grassLeapOrigin = c;
  e.grassLanding = bounded(e, { x: p.x + side * 78, y: p.y - 25 });
  e.grassLeapControl = bounded(e, { x: c.x - side * 80, y: (c.y + e.grassLanding.y) / 2 - 65 });
  e.grassLeapProgress = 0; e.grassWarnProgress = 0; e.grassTimer = 950;
  e.grassAttackPhase = "warn"; e.grassHideAlpha = 1;
  e.grassAimAngle = Math.atan2(e.grassLanding.y - c.y, e.grassLanding.x - c.x);
}
function updateMantis(e, dt, state) {
  const step = stepFor(dt), p = observedPlayer(e, state);
  if (e.grassAttackPhase === "approach" || e.grassAttackPhase === "retreat") {
    if (!e.grassTarget || (e.grassCoverTarget && e.grassCoverTarget.active === false)) seekCover(e, state);
    if (toward(e, e.grassTarget, e.speed * step)) { e.grassAttackPhase = "hide"; e.grassTimer = 2500; }
  } else if (e.grassAttackPhase === "hide") {
    e.grassTimer -= dt;
    const cover = e.grassCoverTarget;
    e.grassHidden = !!(cover && cover.active !== false && cover.hp > 0);
    e.grassHideAlpha = e.grassHidden ? 0.42 : 0.9;
    if (!state.grassConcealed && distance(center(e), p) < 240 && e.grassTimer < 1800) prepareMantis(e, state);
    else if ((!e.grassHidden || e.grassTimer < -3500) && e.grassTimer < 0) { seekCover(e, state); e.grassAttackPhase = "approach"; }
  } else if (e.grassAttackPhase === "warn") {
    e.grassTimer -= dt; e.grassWarnProgress = clamp(1 - e.grassTimer / 950, 0, 1);
    if (e.grassTimer <= 0) { e.grassAttackPhase = "leap"; e.grassHidden = false; }
  } else if (e.grassAttackPhase === "leap") {
    const next = Math.min(1, e.grassLeapProgress + dt / 1050);
    const point = quadratic(e.grassLeapOrigin, e.grassLeapControl, e.grassLanding, next);
    if (toward(e, point, 6.8 * step)) e.grassLeapProgress = next;
    e.grassLeapHeight = Math.sin(Math.PI * e.grassLeapProgress);
    if (e.grassLeapProgress >= 1) {
      e.grassAttackPhase = "recover"; e.grassTimer = 700; e.damageTakenMul = 1.25; e.grassAmbushes += 1;
    }
  } else if (e.grassAttackPhase === "recover") {
    e.grassTimer -= dt;
    if (e.grassTimer <= 0) { e.damageTakenMul = 1; e.grassAttackPhase = "retreat"; e.grassHideAlpha = 1; seekCover(e, state); }
  }
}
function updateBeetle(e, dt, state) {
  const step = stepFor(dt);
  if (e.grassAttackPhase === "approach") {
    e.y += e.speed * step;
    if (e.y >= e.grassHoldY) {
      e.grassAttackPhase = "warn"; e.grassTimer = 1000; e.grassWarnProgress = 0;
      e.grassBallTarget = { ...observedPlayer(e, state) };
      e.grassBallDirection = e.grassBallTarget.x < center(e).x ? -1 : 1;
    }
  } else if (e.grassAttackPhase === "warn") {
    e.grassTimer -= dt; e.grassWarnProgress = clamp(1 - e.grassTimer / 1000, 0, 1);
    if (e.grassTimer <= 0) { e.grassAttackPhase = "push"; e.grassBallReady = true; e.grassTimer = 600; e.grassShellOpen = true; }
  } else if (e.grassAttackPhase === "push") {
    e.grassTimer -= dt; e.y += 0.45 * step;
    if (e.grassTimer <= 0) e.grassAttackPhase = "leave";
  } else { e.y += 1.8 * step; e.x += e.grassBallDirection * 0.7 * step; }
}
function growFlower(e, state) {
  const p = observedPlayer(e, state), c = center(e);
  const y = clamp(Math.max(c.y + 105, p.y - 95), H * 0.42, H * 0.79);
  const x = clamp(p.x, 80, W - 80);
  const a = plantRootBud(state, x - 65, y - 20, e), b = plantRootBud(state, x + 65, y + 20, e);
  e.grassBudRefs = [a, b].filter(Boolean);
  if (a && b) plantVine(state, a, b, e);
  e.grassAttackPhase = "grow"; e.grassTimer = 650; e.grassRootCooldown = 6200;
}
function updateFlower(e, dt, state) {
  if (e.grassAttackPhase === "approach") {
    e.y += e.speed * stepFor(dt);
    if (e.y >= e.grassHoldY) { e.y = e.grassHoldY; e.grassAttackPhase = "rooted"; }
    return;
  }
  e.grassRootCooldown -= dt;
  if (e.grassAttackPhase === "grow") {
    e.grassTimer -= dt; e.grassGrowProgress = clamp(1 - e.grassTimer / 650, 0, 1);
    if (e.grassTimer <= 0) e.grassAttackPhase = "rooted";
  } else if (e.grassRootCooldown <= 0) growFlower(e, state);
}
function prepareSwoop(e, state) {
  const p = observedPlayer(e, state), c = center(e), dx = c.x - p.x, dy = c.y - p.y;
  e.grassSwoopOrigin = c;
  e.grassSwoopTarget = bounded(e, { x: p.x - dx, y: p.y - dy });
  e.grassSwoopControl = bounded(e, { x: p.x - dy * 0.9, y: p.y + dx * 0.9 });
  e.grassSwoopProgress = 0; e.grassAttackPhase = "warn"; e.grassTimer = 650; e.grassWarnProgress = 0;
}
function updateFalcon(e, dt, state) {
  const p = observedPlayer(e, state), step = stepFor(dt);
  if (!e.grassOrbitDir) {
    const other = nearest((state.enemies || []).filter((ally) => ally !== e && ally.type === "galeFalcon" && ally.hp > 0 && ally.grassOrbitDir).map((ally) => ({ ...center(ally), ally })), center(e));
    e.grassOrbitDir = other ? -other.ally.grassOrbitDir : e.vx > 0 ? 1 : -1;
    e.grassOrbitAngle = Math.atan2(center(e).y - p.y, center(e).x - p.x);
    e.grassTimer = 2300; e.grassAttackPhase = "orbit";
  }
  if (e.grassAttackPhase === "orbit") {
    e.grassOrbitAngle += dt * 0.0009 * e.grassOrbitDir;
    const destination = bounded(e, { x: p.x + Math.cos(e.grassOrbitAngle) * e.grassOrbitRadius, y: p.y + Math.sin(e.grassOrbitAngle) * e.grassOrbitRadius });
    toward(e, destination, e.speed * step);
    e.grassTimer -= dt;
    if (e.grassTimer <= 0 && !state.grassConcealed) prepareSwoop(e, state);
    if (e.grassAge > 14500) e.grassAttackPhase = "exit";
  } else if (e.grassAttackPhase === "warn") {
    e.grassTimer -= dt; e.grassWarnProgress = clamp(1 - e.grassTimer / 650, 0, 1);
    if (e.grassTimer <= 0) { e.grassAttackPhase = "swoop"; e.grassFeathersDropped = 0; }
  } else if (e.grassAttackPhase === "swoop") {
    const next = Math.min(1, e.grassSwoopProgress + dt / 1100);
    const point = quadratic(e.grassSwoopOrigin, e.grassSwoopControl, e.grassSwoopTarget, next);
    if (toward(e, point, 6.5 * step)) e.grassSwoopProgress = next;
    if (e.grassSwoopProgress > (e.grassFeathersDropped + 1) * 0.32 && e.grassFeathersDropped < 2) {
      e.grassFeathersDropped += 1; e.grassFeatherPending += 1;
    }
    if (e.grassSwoopProgress >= 1) {
      e.grassSwoops += 1; e.grassAttackPhase = e.grassSwoops >= 2 ? "exit" : "orbit"; e.grassTimer = 2300;
      e.grassOrbitAngle = Math.atan2(center(e).y - p.y, center(e).x - p.x);
    }
  } else if (e.grassAttackPhase === "exit") { e.x += e.grassOrbitDir * 2.6 * step; e.y += 2.9 * step; }
  e.grassAimAngle = Math.atan2(p.y - center(e).y, p.x - center(e).x);
  e.grassSweepPhase = e.grassOrbitAngle;
}
function updateBison(e, dt, state) {
  const p = observedPlayer(e, state), step = stepFor(dt);
  if (e.grassAttackPhase === "tired") {
    e.grassTimer -= dt; e.grassGuardActive = false; e.damageTakenMul = 1.6;
    if (e.grassTimer <= 0) { e.grassAttackPhase = "guard"; e.grassGuardTimer = 4800; e.damageTakenMul = 1; }
    return;
  }
  const allies = (state.enemies || []).filter((ally) => ally !== e && !ally.isBoss && ally.hp > 0
    && (ally.type === "thornBloom" || ally.hp < ally.maxHp * 0.75));
  allies.sort((a, b) => (a.type === "thornBloom" ? -2 : a.hp / a.maxHp) - (b.type === "thornBloom" ? -2 : b.hp / b.maxHp));
  e.grassGuardTarget = allies[0] || null;
  const ally = e.grassGuardTarget ? center(e.grassGuardTarget) : { x: W / 2, y: H * 0.30 };
  const angle = Math.atan2(p.y - ally.y, p.x - ally.x);
  e.grassGuardAngle = angle; e.grassGuardArc = 1; e.grassGuardActive = e.y >= 80;
  const guard = bounded(e, { x: ally.x + Math.cos(angle) * 78, y: ally.y + Math.sin(angle) * 78 });
  toward(e, guard, e.speed * step); e.grassAttackPhase = "guard";
  e.grassGuardTimer -= dt;
  if (e.grassGuardTimer <= 0) { e.grassAttackPhase = "tired"; e.grassTimer = 1800; e.grassGuardActive = false; e.damageTakenMul = 1.6; }
}
function updateGrasslandEnemy(e, delta, state) {
  const dt = Math.max(0, delta), s = state || {};
  e.grassAge = (e.grassAge || 0) + dt; e.grassPulse = 0.5 + Math.sin(e.grassAge * 0.006) * 0.5;
  if (e.type === "meadowHare") updateHare(e, dt, s);
  else if (e.type === "bladeMantis") updateMantis(e, dt, s);
  else if (e.type === "lanternBeetle") updateBeetle(e, dt, s);
  else if (e.type === "thornBloom") updateFlower(e, dt, s);
  else if (e.type === "galeFalcon") updateFalcon(e, dt, s);
  else if (e.type === "thunderBison") updateBison(e, dt, s);
  if (e.type !== "galeFalcon") e.x = clamp(e.x, 4, Math.max(4, W - e.w - 4));
}
function maybeFireGrasslandEnemy(e, delta, state, fireFn) {
  if (e.grassBallReady) {
    e.grassBallReady = false;
    const c = center(e);
    fireFn({ x: c.x - 15, y: e.y + e.h, w: 30, h: 30, vx: e.grassBallDirection * 4.3, vy: 1.65,
      dmg: 1.3, color: "#d3b47a", grassBullet: true, grassBall: true, bounces: 2, grassBallAngle: 0 });
  }
  if (e.grassFeatherPending > 0) {
    e.grassFeatherPending -= 1; const c = center(e);
    fireFn({ x: c.x - 4, y: c.y - 8, w: 8, h: 16, vx: e.grassOrbitDir * 0.35, vy: 1.2,
      dmg: 0.8, color: "#efcf99", grassBullet: true, grassFeather: true });
  }
}
/** 前甲只挡迎面主炮；卫星与炸弹由战斗层直接结算，给玩家侧击手段。 */
function grassDamageTakenMul(enemy, bullet) {
  if (!enemy || !enemy.grassGuardActive || !bullet) return 1;
  const c = center(enemy), sx = bullet.x + (bullet.w || 6) / 2 - (bullet.vx || 0) * 16;
  const sy = bullet.y + (bullet.h || 6) / 2 - (bullet.vy || 0) * 16;
  const a = Math.atan2(sy - c.y, sx - c.x), d = Math.atan2(Math.sin(a - enemy.grassGuardAngle), Math.cos(a - enemy.grassGuardAngle));
  return Math.abs(d) <= (enemy.grassGuardArc || 1) ? (enemy.bossVariant === "antlerKing" ? 0.55 : 0.35) : 1;
}
module.exports = { createMeadowHare, createBladeMantis, createLanternBeetle, createThornBloom,
  createGaleFalcon, createThunderBison, updateGrasslandEnemy, maybeFireGrasslandEnemy, grassDamageTakenMul };
