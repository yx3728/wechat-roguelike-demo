/** 苍岚鹿王管理草场与兽群：曲线犁地、护群、根园，按战场情况决策。 */
const { W, H } = require("../../../src/config.js");
const { crushCover, plantRootBud, plantVine } = require("../../../src/grasslandMechanics.js");
const { createGaleFalcon, createThornBloom } = require("../../../src/grasslandEnemies.js");
const GRASS_BOSS_SEQUENCES = { 1: ["antlerPlow", "herdGuard", "rootGarden"], 2: ["antlerPlow", "herdGuard", "rootGarden"] };
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function stepFor(dt) { return Math.min(3, Math.max(0, dt) / 16.667); }
function center(e) { return { x: e.x + e.w / 2, y: e.y + e.h / 2 }; }
function length(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function covers(state) { return (state.grassCover || []).filter((c) => c && c.active !== false && c.hp > 0); }
function adds(state) { return (state.enemies || []).filter((e) => e && !e.isBoss && e.hp > 0); }
function ownAdds(boss, state) { return adds(state).filter((e) => e.grassOwnerBoss === boss); }
function observedPlayer(boss, state) {
  if (state.player && !state.grassConcealed) boss.grassLastSeenPlayer = center(state.player);
  return boss.grassLastSeenPlayer || { x: W / 2, y: H * 0.65 };
}
function bounded(boss, p) {
  return { x: clamp(p.x, boss.w / 2 + 14, W - boss.w / 2 - 14),
    y: clamp(p.y, (boss.targetY || 220) + boss.h / 2, H - boss.h / 2 - 64) };
}
function quadratic(a, b, c, t) { const u = 1 - t; return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y }; }
/** 两段二次曲线在第一个路标相接；controls 两侧沿同一切线，确实穿过两个路标。 */
function sampleGrassPlowPath(points, controls, t) {
  return t <= 0.5 ? quadratic(points[0], controls[0], points[1], t * 2)
    : quadratic(points[1], controls[1], points[2], (t - 0.5) * 2);
}
function pose(boss, dt, motion, dx, dy) {
  const blend = 1 - Math.exp(-dt / 140), step = Math.max(0.01, stepFor(dt));
  boss.grassMotionPhase = motion;
  boss.grassBank = (boss.grassBank || 0) + (clamp(dx / step * 0.036, -0.12, 0.12) - (boss.grassBank || 0)) * blend;
  boss.grassThrust = (boss.grassThrust || 0) + (clamp(0.16 + Math.hypot(dx, dy) / step * 0.1, 0, 1) - (boss.grassThrust || 0)) * blend;
}
function toward(boss, target, dt, speed, motion) {
  const c = center(boss), d = length(c, target), amount = Math.min(d, speed * stepFor(dt));
  const dx = d ? (target.x - c.x) / d * amount : 0, dy = d ? (target.y - c.y) / d * amount : 0;
  boss.x += dx; boss.y += dy; pose(boss, dt, motion, dx, dy);
  return d <= amount + 0.01;
}
function patrol(boss, dt) {
  if (!boss.grassAnchor || length(center(boss), boss.grassAnchor) < 8) {
    const index = boss.grassAnchorIndex || 0; boss.grassAnchorIndex = index + 1;
    boss.grassAnchor = bounded(boss, { x: W * [0.26, 0.73, 0.34, 0.66][index % 4], y: (boss.targetY || 220) + boss.h / 2 + [15, 75, 35, 60][index % 4] });
  }
  const d = length(center(boss), boss.grassAnchor);
  toward(boss, boss.grassAnchor, dt, Math.min(2.4, Math.max(0.35, d * 0.04)), "prowl");
}
function init(boss) {
  boss.grassPhase = boss.grassPhase || 1;
  boss.grassState = boss.grassState || "idle";
  if (!Number.isFinite(boss.grassTimer)) boss.grassTimer = 850;
  boss.grassCooldowns = boss.grassCooldowns || { antlerPlow: 0, herdGuard: 0, rootGarden: 0 };
  boss.grassLastUsed = boss.grassLastUsed || {};
  boss.grassClock = boss.grassClock || 0;
  boss.grassActionCounts = boss.grassActionCounts || { antlerPlow: 0, herdGuard: 0, rootGarden: 0 };
}
/** 高草中藏身会引来犁地；场上有同伴时优先护群，开阔场地则重新栽根。 */
function chooseGrassBossAttack(boss, state) {
  init(boss);
  const cover = covers(state), herd = ownAdds(boss, state), count = adds(state).length;
  const rootCount = (state.grassRootBuds || []).filter((b) => b.owner === boss && b.hp > 0).length;
  const scores = {
    antlerPlow: state.grassConcealed && cover.length ? 12 : cover.length >= 2 ? 6 : 2,
    herdGuard: herd.length ? 11 : count < 4 ? 5 : -100,
    rootGarden: rootCount < 3 ? (cover.length < 2 ? 9 : 5) : 1,
  };
  let selected = null, highest = -Infinity;
  for (const attack of GRASS_BOSS_SEQUENCES[boss.grassPhase]) {
    if (boss.grassCooldowns[attack] > 0 || scores[attack] < -10) continue;
    let score = scores[attack];
    if (!boss.grassActionCounts[attack]) score += 1.5;
    if (boss.grassLastAttack === attack) score -= 4;
    const last = boss.grassLastUsed[attack] || 0;
    if (boss.grassClock - last > 26000) score += 14;
    if (score > highest) { selected = attack; highest = score; }
  }
  return selected;
}
function planPlow(boss, state) {
  const p = observedPlayer(boss, state), start = center(boss), clumps = covers(state);
  let target = p;
  if (state.grassConcealed && clumps.length) {
    // 调查记忆中最近草丛，不透视隐蔽玩家的实时坐标。
    clumps.sort((a, b) => length(a, p) - length(b, p)); target = clumps[0];
  }
  const first = bounded(boss, { x: target.x, y: clamp(target.y, H * 0.46, H * 0.74) });
  const second = bounded(boss, { x: first.x < W / 2 ? W * 0.74 : W * 0.26,
    y: (boss.targetY || 220) + boss.h / 2 + 60 });
  const direction = { x: second.x - start.x, y: second.y - start.y };
  const d = Math.hypot(direction.x, direction.y) || 1;
  const tangent = { x: direction.x / d * 72, y: direction.y / d * 72 };
  boss.grassPlowPoints = [start, first, second];
  boss.grassPlowControls = [bounded(boss, { x: first.x - tangent.x, y: first.y - tangent.y }),
    bounded(boss, { x: first.x + tangent.x, y: first.y + tangent.y })];
  boss.grassPlowProgress = 0; boss.grassPlowElapsed = 0;
  let total = 0, prev = start;
  for (let i = 1; i <= 40; i += 1) { const next = sampleGrassPlowPath(boss.grassPlowPoints, boss.grassPlowControls, i / 40); total += length(prev, next); prev = next; }
  boss.grassPlowLength = Math.max(1, total);
  boss.grassTarget = first;
}
function planGarden(boss, state) {
  const p = observedPlayer(boss, state), count = boss.grassPhase === 2 ? 4 : 3;
  const x = clamp(p.x, 110, W - 110), y = clamp(p.y - 50, H * 0.46, H * 0.72);
  boss.grassGardenPoints = [];
  for (let i = 0; i < count; i += 1) {
    const a = -Math.PI / 2 + Math.PI * 2 * i / count;
    boss.grassGardenPoints.push({ x: clamp(x + Math.cos(a) * 100, 22, W - 22), y: clamp(y + Math.sin(a) * 90, H * 0.38, H - 70) });
  }
}
function begin(boss, state, attack) {
  boss.grassAttack = attack; boss.grassLastAttack = attack; boss.currentAttack = attack;
  boss.grassLastUsed[attack] = boss.grassClock; boss.grassActionCounts[attack] += 1;
  boss.grassCooldowns[attack] = (attack === "antlerPlow" ? 11000 : 15000) * (boss.grassPhase === 2 ? 0.82 : 1);
  boss.grassWarnMs = attack === "antlerPlow" ? (boss.grassPhase === 2 ? 1000 : 1200) : 900;
  boss.grassTimer = boss.grassWarnMs; boss.grassWarnProgress = 0; boss.grassState = "warn";
  boss.grassWarnOrigin = center(boss); boss.grassGuardActive = false; boss.grassAnchor = null;
  boss.damageTakenMul = 1; boss.hanbaOverheat = false; boss.overheatMs = 0;
  boss.grassDecisionReason = attack === "antlerPlow" ? (state.grassConcealed ? "investigateCover" : "clearTrail")
    : attack === "herdGuard" ? "protectHerd" : "replantTerrain";
  if (attack === "antlerPlow") planPlow(boss, state);
  if (attack === "rootGarden") planGarden(boss, state);
  if (attack === "herdGuard") {
    const herd = ownAdds(boss, state), capacity = Math.max(0, 4 - adds(state).length);
    const wanted = ["galeFalcon", "galeFalcon", "thornBloom"], used = {};
    herd.forEach((e) => { used[e.type] = (used[e.type] || 0) + 1; });
    boss.grassHerdSpawns = [];
    for (let i = 0; i < wanted.length && boss.grassHerdSpawns.length < capacity; i += 1) {
      const type = wanted[i];
      if (used[type] > 0) { used[type] -= 1; continue; }
      const pos = { x: clamp(boss.x + boss.w * (i === 0 ? -0.18 : i === 1 ? 0.93 : 0.4), 18, W - 65),
        y: clamp(boss.y + boss.h + (type === "thornBloom" ? 5 : 45), 200, H * 0.56) };
      boss.grassHerdSpawns.push({ type, ...pos });
    }
  }
}
function stagger(boss, ms) {
  boss.grassState = "stagger"; boss.grassTimer = ms; boss.currentAttack = null;
  boss.grassGuardActive = false; boss.damageTakenMul = 1.55; boss.hanbaOverheat = true;
  boss.overheatMs = ms; boss.overheatDmgMul = 1.55; boss.grassWarnProgress = 0; boss.grassAnchor = null;
}
function releaseAction(boss, state, spawnFn) {
  if (boss.grassAttack === "antlerPlow") { boss.grassState = "plow"; return; }
  if (boss.grassAttack === "rootGarden") {
    boss.grassGardenNodes = boss.grassGardenPoints.map((p) => plantRootBud(state, p.x, p.y, boss)).filter(Boolean);
    for (let i = 0; i < boss.grassGardenNodes.length; i += 1) {
      plantVine(state, boss.grassGardenNodes[i], boss.grassGardenNodes[(i + 1) % boss.grassGardenNodes.length], boss);
    }
    boss.grassState = "grow"; boss.grassTimer = 2300; return;
  }
  const plans = boss.grassHerdSpawns || [];
  for (const plan of plans) {
    if (adds(state).length >= 4) break;
    let add;
    if (typeof spawnFn === "function") add = spawnFn({ pattern: "grassHerd", ...plan, owner: boss });
    else {
      add = plan.type === "thornBloom" ? createThornBloom(state.level || 1) : createGaleFalcon(state.level || 1);
      Object.assign(add, { x: plan.x, y: plan.y });
      if (!state.enemies) state.enemies = [];
      state.enemies.push(add);
    }
    if (add) { add.grassOwnerBoss = boss; add.grassHerdAdd = true; if (add.type === "thornBloom") add.grassHoldY = add.y; }
  }
  boss.grassState = "guard"; boss.grassTimer = 6500; boss.currentAttack = null;
  boss.grassHadHerd = ownAdds(boss, state).length > 0; boss.grassGuardActive = true;
}
function updateGrasslandBoss(boss, delta, state, fireFn, spawnFn) {
  const dt = Math.max(0, delta); init(boss);
  boss.grassClock += dt;
  boss.grassSwimPhase = (boss.grassSwimPhase || 0) + dt * 0.004 * (0.8 + (boss.grassThrust || 0));
  Object.keys(boss.grassCooldowns).forEach((key) => { boss.grassCooldowns[key] = Math.max(0, boss.grassCooldowns[key] - dt); });
  observedPlayer(boss, state);
  if (!boss.entered) {
    const target = { x: center(boss).x, y: (boss.targetY || 220) + boss.h / 2 };
    if (toward(boss, target, dt, boss.speed || 1.6, "approach")) boss.entered = true;
    return;
  }
  if (boss.hp <= boss.maxHp * 0.5 && boss.grassPhase !== 2) {
    boss.grassPhase = 2; boss.grassState = "transition"; boss.grassTimer = 1200;
    boss.currentAttack = null; boss.grassAttack = null; boss.grassWarnProgress = 0;
    boss.grassGuardActive = false; boss.damageTakenMul = 1; boss.hanbaOverheat = false; boss.overheatMs = 0;
    boss.grassAnchor = null;
    return;
  }
  if (boss.grassState === "warn") {
    boss.grassTimer -= dt; boss.grassWarnProgress = clamp(1 - boss.grassTimer / boss.grassWarnMs, 0, 1);
    pose(boss, dt, "windup", 0, 0);
    if (boss.grassTimer <= 0) releaseAction(boss, state, spawnFn);
    return;
  }
  if (boss.grassState === "plow") {
    boss.grassPlowElapsed += dt;
    const speed = boss.grassPhase === 2 ? 8.4 : 7.0;
    const next = Math.min(1, boss.grassPlowProgress + speed * stepFor(dt) / boss.grassPlowLength);
    const point = sampleGrassPlowPath(boss.grassPlowPoints, boss.grassPlowControls, next);
    if (toward(boss, point, dt, speed, "charge")) boss.grassPlowProgress = next;
    const c = center(boss); crushCover(state, c.x, c.y, boss.w * 0.43);
    if (boss.grassPlowProgress >= 1 || boss.grassPlowElapsed > 8000) stagger(boss, 1800);
    return;
  }
  if (boss.grassState === "guard") {
    boss.grassTimer -= dt;
    const herd = ownAdds(boss, state);
    if (boss.grassHadHerd && !herd.length) { stagger(boss, 2400); return; }
    const guarded = herd.find((e) => e.type === "thornBloom") || herd[0];
    const ally = guarded ? center(guarded) : center(boss), p = observedPlayer(boss, state);
    const angle = Math.atan2(p.y - ally.y, p.x - ally.x);
    boss.grassGuardTarget = guarded || null; boss.grassGuardAngle = angle; boss.grassGuardArc = 1;
    const target = bounded(boss, { x: ally.x + Math.cos(angle) * 88, y: Math.min(H * 0.58, ally.y + Math.sin(angle) * 88) });
    toward(boss, target, dt, 2.1, "guard");
    if (boss.grassTimer <= 0 || !herd.length) { boss.grassState = "recover"; boss.grassTimer = 900; boss.grassGuardActive = false; }
    return;
  }
  if (boss.grassState === "grow") {
    boss.grassTimer -= dt; boss.grassGrowProgress = clamp(1 - boss.grassTimer / 2300, 0, 1);
    patrol(boss, dt);
    if (boss.grassTimer <= 0) { boss.grassState = "recover"; boss.grassTimer = 800; boss.currentAttack = null; }
    return;
  }
  boss.grassTimer -= dt;
  if (boss.grassState === "stagger") {
    boss.overheatMs = Math.max(0, boss.grassTimer); pose(boss, dt, "stagger", 0, 0);
    if (boss.grassTimer > 0) return;
    boss.hanbaOverheat = false; boss.damageTakenMul = 1; boss.grassState = "recover"; boss.grassTimer = 700;
  } else patrol(boss, dt);
  if (boss.grassTimer > 0) return;
  boss.grassState = "idle";
  const attack = chooseGrassBossAttack(boss, state);
  if (attack) begin(boss, state, attack);
}
module.exports = { updateGrasslandBoss, GRASS_BOSS_SEQUENCES, chooseGrassBossAttack, sampleGrassPlowPath };
