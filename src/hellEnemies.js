/**
 * hellEnemies.js
 * ----------------------------------------------------------------------------
 * 地狱敌群。两条规矩：
 *   1. 每种敌人开火前都有名为 `warn` 的预警相（hellVisuals 只按这个名字画预警圈），
 *      **预警期间本体不位移、锁定目标不变**——这是草原立下的规矩，这里照办。
 *   2. 每一种都必须跟魂火回路有关系。只会打枪的不要。
 *
 * 配色：本体一律焦黑（relL ≤ 0.017，旧敌人从没进过这个亮度区间），
 * 可读性交给 rimColor 轮廓光（对最差底色 10.5–14.7:1）。
 * 高饱和只留给危险色，见 docs/hell-map.md 第三节。
 * ----------------------------------------------------------------------------
 */
const { W, H } = require("./config.js");
const { dropSoulfire, igniteSoulfiresAt, snapAllFuses } = require("./hellMechanics.js");

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function stepFor(dt) { return Math.min(3, Math.max(0, dt) / 16.667); }
function center(e) { return { x: e.x + e.w / 2, y: e.y + e.h / 2 }; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function playerPoint(state) {
  const p = state && state.player;
  return p ? { x: p.x + p.w / 2, y: p.y + p.h / 2 } : { x: W / 2, y: H * 0.72 };
}
function soulfires(state) { return (state && state.hellSoulfires) || []; }
function nearestSoulfire(state, point) {
  return soulfires(state).reduce((best, f) => (!best || distance(f, point) < distance(best, point) ? f : best), null);
}
function toward(e, target, amount) {
  const c = center(e), dx = target.x - c.x, dy = target.y - c.y, d = Math.hypot(dx, dy);
  if (d <= amount || d === 0) { e.x = target.x - e.w / 2; e.y = target.y - e.h / 2; return true; }
  e.x += (dx / d) * amount; e.y += (dy / d) * amount; return false;
}
function bounded(e, p) {
  return { x: clamp(p.x, e.w / 2 + 6, W - e.w / 2 - 6), y: clamp(p.y, 90, H - e.h / 2 - 30) };
}

function create(type, level, options) {
  const lv = Math.max(1, Number(level) || 1);
  const hp = (options.hp + Math.floor(lv / (options.hpGrowth || 4))) * 1000;
  return Object.assign({
    type, isHell: true,
    x: 12 + Math.random() * Math.max(1, W - options.w - 24),
    y: -options.h - 12, vx: 0, speed: 1, exp: 9, coin: 1,
    hellAge: 0, hellPulse: 0, hellAttackPhase: "approach", hellWarnProgress: 0,
    hellAimAngle: Math.PI / 2, hellTarget: null, hellTimer: 0,
    fireCooldown: 1600, neverFires: true,
    /** 死后掉的魂火引信；不写就用全局 4.5 秒 */
    hellFuseMs: null,
  }, options, { hp, maxHp: hp });
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

/** 焦骨：基础兵。引信只有 3.0 秒——教玩家"这个得马上去收" */
function createCinderHusk(level) {
  return create("cinderHusk", level, {
    color: "#1f1c22", rimColor: "#e8e2d6", w: 28, h: 32, hp: 2, hpGrowth: 4, speed: 1.25,
    hellHoldY: H * (0.18 + Math.random() * 0.16), hellFuseMs: 3000, exp: 9, coin: 1,
  });
}

/** 拾魂者：完全不打玩家，只抢魂火。每吃一个变大变壮 */
function createSoulPicker(level) {
  return create("soulPicker", level, {
    color: "#26201c", rimColor: "#e4dcc8", w: 26, h: 26, hp: 1, hpGrowth: 5, speed: 2.5,
    hellEaten: 0, hellFuseMs: 8000, exp: 12, coin: 2,
  });
}

/** 烙印使：烙在玩家当前位置，1.1 秒后炸开；印记盖到魂火上会直接点燃它 */
function createBrandBearer(level) {
  return create("brandBearer", level, {
    color: "#1c1f24", rimColor: "#dce6f0", w: 32, h: 34, hp: 3, hpGrowth: 3, speed: 1.0,
    hellHoldY: H * (0.20 + Math.random() * 0.12), hellBrandCd: 1400, exp: 16, coin: 2,
  });
}

/** 锁魂：把玩家朝最近的魂火拖。看起来在帮你，实际是把你拽进别人的弹道 */
function createChainWarden(level) {
  return create("chainWarden", level, {
    color: "#231d20", rimColor: "#ded6e8", w: 30, h: 36, hp: 3, hpGrowth: 3, speed: 1.15,
    hellHoldY: H * (0.22 + Math.random() * 0.12), hellChainCd: 2200, exp: 15, coin: 2,
  });
}

/** 炉喉：固定炮台，推出 3 颗慢速炉火；炉火不出屏消失，会在原地烧成一片 */
function createForgeGullet(level) {
  return create("forgeGullet", level, {
    color: "#201e1a", rimColor: "#f0e8d2", w: 38, h: 34, hp: 5, hpGrowth: 2, speed: 0.8,
    hellHoldY: H * (0.16 + Math.random() * 0.10), hellVolleyCd: 1200, exp: 24, coin: 4,
  });
}

/** 刑官（精英）：光环内引信 2× 速烧；死亡时全场引信跳到剩余 1.5 秒 */
function createWarden(level) {
  const lv = Math.max(1, Number(level) || 1);
  const e = create("warden", level, {
    color: "#2a2026", rimColor: "#fbf4e4", w: 60, h: 60, hp: 54, speed: 1.5,
    hellWardenAura: 132, hellSweepCd: 2600, exp: 46, coin: 9, isElite: true,
    hellHoldY: H * 0.30,
  });
  e.hp = e.maxHp = (54 + Math.floor(lv * 0.8)) * 1000;
  return e;
}

/**
 * 亡魂：魂火引信烧完站起来的东西。
 * **只有接触伤害，且击杀它不再产生魂火**（isHellRevenant 让 battle.js 跳过 dropSoulfire）。
 */
function createRevenant(request) {
  const req = request || {};
  const w = clamp(Number(req.srcW) || 26, 16, 44);
  const h = clamp(Number(req.srcH) || 28, 16, 44);
  const hp = Math.max(800, Math.round((Number(req.srcMaxHp) || 3000) * 0.45));
  return {
    type: "revenant", isHell: true, isHellRevenant: true, noItemDrop: true,
    color: "#1f1c22", rimColor: "#ff6b3d",
    x: clamp((Number(req.x) || W / 2) - w / 2, 2, W - w - 2),
    y: clamp((Number(req.y) || H / 2) - h / 2, 2, H - h - 2),
    w, h, vx: 0, hp, maxHp: hp, speed: 1.8, exp: 0, coin: 0,
    hellAge: 0, hellPulse: 0, hellAttackPhase: "rise", hellWarnProgress: 0,
    hellTimer: 420, hellAimAngle: Math.PI / 2, hellRiseProgress: 0,
    fireCooldown: 99999, neverFires: true, hellFuseMs: null,
  };
}

// ---------------------------------------------------------------------------
// 行为
// ---------------------------------------------------------------------------

function approachHold(e, dt) {
  e.y += e.speed * stepFor(dt);
  if (e.y >= e.hellHoldY) { e.y = e.hellHoldY; return true; }
  return false;
}

/** 焦骨：飘到位后瞄准玩家，预警 1200ms 再打一发 */
function updateCinderHusk(e, dt, state) {
  const step = stepFor(dt);
  if (e.hellAttackPhase === "approach") {
    if (approachHold(e, dt)) { e.hellAttackPhase = "idle"; e.hellTimer = 700; }
    return;
  }
  if (e.hellAttackPhase === "idle") {
    e.x += Math.sin(e.hellAge * 0.0032) * 0.55 * step;
    e.hellTimer -= dt;
    if (e.hellTimer <= 0) {
      const p = playerPoint(state), c = center(e);
      e.hellTarget = { x: p.x, y: p.y };
      e.hellAimAngle = Math.atan2(p.y - c.y, p.x - c.x);
      e.hellAttackPhase = "warn"; e.hellTimer = 1200; e.hellWarnProgress = 0;
    }
    return;
  }
  if (e.hellAttackPhase === "warn") {
    // 预警期间不动、不改锁定
    e.hellTimer -= dt;
    e.hellWarnProgress = clamp(1 - e.hellTimer / 1200, 0, 1);
    if (e.hellTimer <= 0) { e.hellAttackPhase = "fire"; e.hellShotReady = true; }
    return;
  }
  e.hellAttackPhase = "idle";
  e.hellTimer = 1500;
}

/** 拾魂者：径直飞向最近的魂火并吃掉它；吃一个胖一圈 */
function updateSoulPicker(e, dt, state) {
  const step = stepFor(dt);
  const c = center(e);
  const fire = nearestSoulfire(state, c);
  e.hellAttackPhase = fire ? "hunt" : "drift";
  if (!fire) {
    e.y += e.speed * 0.5 * step;
    e.x += Math.sin(e.hellAge * 0.0045) * 1.1 * step;
    return;
  }
  e.hellTarget = { x: fire.x, y: fire.y };
  if (toward(e, { x: fire.x, y: fire.y }, e.speed * 1.5 * step)) {
    const index = (state.hellSoulfires || []).indexOf(fire);
    if (index >= 0) {
      state.hellSoulfires.splice(index, 1);
      e.hellEaten += 1;
      e.hellEatFlashMs = 260;
      e.maxHp = Math.round(e.maxHp * 1.3);
      e.hp = Math.round(e.hp * 1.3);
      e.w = Math.min(46, e.w + 4);
      e.h = Math.min(46, e.h + 4);
      e.exp += 6;
    }
  }
  e.hellEatFlashMs = Math.max(0, (e.hellEatFlashMs || 0) - dt);
}

/** 烙印使：预警 900ms 后在玩家**当时**的位置烙下印记，1.1 秒后炸开 */
function updateBrandBearer(e, dt, state) {
  const step = stepFor(dt);
  if (e.hellAttackPhase === "approach") {
    if (approachHold(e, dt)) { e.hellAttackPhase = "idle"; e.hellTimer = e.hellBrandCd; }
    return;
  }
  if (e.hellAttackPhase === "idle") {
    e.x += Math.sin(e.hellAge * 0.0028) * 0.5 * step;
    e.hellTimer -= dt;
    if (e.hellTimer <= 0) {
      const p = playerPoint(state);
      e.hellTarget = { x: p.x, y: p.y };
      e.hellAttackPhase = "warn"; e.hellTimer = 900; e.hellWarnProgress = 0;
    }
    return;
  }
  if (e.hellAttackPhase === "warn") {
    e.hellTimer -= dt;
    e.hellWarnProgress = clamp(1 - e.hellTimer / 900, 0, 1);
    if (e.hellTimer <= 0) {
      e.hellAttackPhase = "brand"; e.hellTimer = 1100;
      e.hellBrand = { x: e.hellTarget.x, y: e.hellTarget.y, r: 46, ms: 1100, maxMs: 1100 };
    }
    return;
  }
  if (e.hellAttackPhase === "brand") {
    e.hellTimer -= dt;
    if (e.hellBrand) e.hellBrand.ms = Math.max(0, e.hellBrand.ms - dt);
    if (e.hellTimer <= 0) {
      // 印记落在魂火上 → 直接点燃
      if (e.hellBrand) igniteSoulfiresAt(state, e.hellBrand.x, e.hellBrand.y, e.hellBrand.r);
      e.hellBrandBurst = e.hellBrand;
      e.hellBrand = null;
      e.hellAttackPhase = "idle"; e.hellTimer = e.hellBrandCd;
    }
  }
}

/** 锁魂：预警 1000ms 后甩链，把玩家朝最近的魂火拖 2.2 秒 */
function updateChainWarden(e, dt, state) {
  const step = stepFor(dt);
  if (e.hellAttackPhase === "approach") {
    if (approachHold(e, dt)) { e.hellAttackPhase = "idle"; e.hellTimer = e.hellChainCd; }
    return;
  }
  if (e.hellAttackPhase === "idle") {
    e.x += Math.sin(e.hellAge * 0.0035) * 0.6 * step;
    e.hellTimer -= dt;
    const fire = nearestSoulfire(state, playerPoint(state));
    if (e.hellTimer <= 0 && fire) {
      e.hellTarget = { x: fire.x, y: fire.y };
      e.hellAttackPhase = "warn"; e.hellTimer = 1000; e.hellWarnProgress = 0;
    } else if (e.hellTimer <= 0) {
      e.hellTimer = 600;
    }
    return;
  }
  if (e.hellAttackPhase === "warn") {
    e.hellTimer -= dt;
    e.hellWarnProgress = clamp(1 - e.hellTimer / 1000, 0, 1);
    if (e.hellTimer <= 0) { e.hellAttackPhase = "pull"; e.hellTimer = 2200; }
    return;
  }
  if (e.hellAttackPhase === "pull") {
    e.hellTimer -= dt;
    const anchor = e.hellTarget;
    if (anchor) {
      state.hellChain = { x: anchor.x, y: anchor.y, from: center(e), strength: 118 };
    }
    if (e.hellTimer <= 0) { e.hellAttackPhase = "idle"; e.hellTimer = e.hellChainCd; }
  }
}

/** 炉喉：预警 1300ms，沿固定弹道推出 3 颗慢速炉火 */
function updateForgeGullet(e, dt, state) {
  if (e.hellAttackPhase === "approach") {
    if (approachHold(e, dt)) { e.hellAttackPhase = "idle"; e.hellTimer = e.hellVolleyCd; }
    return;
  }
  if (e.hellAttackPhase === "idle") {
    e.hellTimer -= dt;
    if (e.hellTimer <= 0) {
      const p = playerPoint(state), c = center(e);
      e.hellAimAngle = Math.atan2(p.y - c.y, p.x - c.x);
      e.hellAttackPhase = "warn"; e.hellTimer = 1300; e.hellWarnProgress = 0;
    }
    return;
  }
  if (e.hellAttackPhase === "warn") {
    e.hellTimer -= dt;
    e.hellWarnProgress = clamp(1 - e.hellTimer / 1300, 0, 1);
    if (e.hellTimer <= 0) { e.hellAttackPhase = "spit"; e.hellVolleyPending = 3; e.hellTimer = 700; }
    return;
  }
  if (e.hellAttackPhase === "spit") {
    e.hellTimer -= dt;
    if (e.hellTimer <= 0) { e.hellAttackPhase = "idle"; e.hellTimer = e.hellVolleyCd; }
  }
}

/** 刑官：绕着玩家上方压制，光环加速全场引信；扇形齐射前照样要预警 */
function updateWarden(e, dt, state) {
  const step = stepFor(dt);
  const p = playerPoint(state);
  if (e.hellAttackPhase === "approach") {
    if (approachHold(e, dt)) { e.hellAttackPhase = "press"; e.hellTimer = e.hellSweepCd; }
    return;
  }
  if (e.hellAttackPhase === "warn") {
    // 预警期间不位移、不改锁定
    e.hellTimer -= dt;
    e.hellWarnProgress = clamp(1 - e.hellTimer / 850, 0, 1);
    if (e.hellTimer <= 0) { e.hellSweepReady = true; e.hellAttackPhase = "press"; e.hellTimer = e.hellSweepCd; }
    return;
  }
  const target = bounded(e, { x: p.x, y: Math.max(H * 0.24, p.y - 250) });
  toward(e, target, e.speed * step);
  e.hellTimer -= dt;
  if (e.hellTimer <= 0) {
    e.hellTarget = { x: p.x, y: p.y };
    e.hellAttackPhase = "warn"; e.hellTimer = 850; e.hellWarnProgress = 0;
    return;
  }
  e.hellAttackPhase = "press";
}

/** 亡魂：起身 420ms（不可被打断的可读窗口），然后直扑玩家 */
function updateRevenant(e, dt, state) {
  const step = stepFor(dt);
  if (e.hellAttackPhase === "rise") {
    e.hellTimer -= dt;
    e.hellRiseProgress = clamp(1 - e.hellTimer / 420, 0, 1);
    if (e.hellTimer <= 0) { e.hellAttackPhase = "chase"; e.hellRiseProgress = 1; }
    return;
  }
  const p = playerPoint(state), c = center(e);
  e.hellAimAngle = Math.atan2(p.y - c.y, p.x - c.x);
  toward(e, p, e.speed * step * 1.9);
}

function updateHellEnemy(e, delta, state) {
  const dt = Math.max(0, delta), s = state || {};
  e.hellAge = (e.hellAge || 0) + dt;
  e.hellPulse = 0.5 + Math.sin(e.hellAge * 0.006) * 0.5;
  if (e.type === "cinderHusk") updateCinderHusk(e, dt, s);
  else if (e.type === "soulPicker") updateSoulPicker(e, dt, s);
  else if (e.type === "brandBearer") updateBrandBearer(e, dt, s);
  else if (e.type === "chainWarden") updateChainWarden(e, dt, s);
  else if (e.type === "forgeGullet") updateForgeGullet(e, dt, s);
  else if (e.type === "warden") updateWarden(e, dt, s);
  else if (e.type === "revenant") updateRevenant(e, dt, s);
  e.x = clamp(e.x, 2, Math.max(2, W - e.w - 2));
  e.y = clamp(e.y, -e.h - 20, H - 8);
}

function maybeFireHellEnemy(e, delta, state, fireFn) {
  const c = center(e);
  if (e.hellShotReady) {
    e.hellShotReady = false;
    const a = e.hellAimAngle;
    fireFn({
      x: c.x - 5, y: c.y + e.h / 2, w: 10, h: 10,
      vx: Math.cos(a) * 4.6, vy: Math.sin(a) * 4.6,
      dmg: 1.15, color: "#ff3b30", hellBullet: true,
    });
  }
  if (e.hellVolleyPending > 0) {
    e.hellVolleyPending -= 1;
    const a = e.hellAimAngle + (e.hellVolleyPending - 1) * 0.20;
    fireFn({
      x: c.x - 11, y: c.y + e.h / 2, w: 22, h: 22,
      vx: Math.cos(a) * 1.55, vy: Math.sin(a) * 1.55,
      dmg: 1.3, color: "#ff6b3d", hellBullet: true,
      hellLinger: true, hellLingerMs: 3000, hellBurnMs: 2600,
    });
  }
  if (e.hellSweepReady) {
    e.hellSweepReady = false;
    for (let i = 0; i < 5; i += 1) {
      const a = Math.PI / 2 + (i - 2) * 0.30;
      fireFn({
        x: c.x - 6, y: c.y + e.h / 2, w: 12, h: 12,
        vx: Math.cos(a) * 3.5, vy: Math.sin(a) * 3.5,
        dmg: 1.25, color: "#ff3b30", hellBullet: true,
      });
    }
  }
}

/** 刑官死亡：全场引信跳到剩余 1.5 秒。由 battle.js 在击杀时调用 */
function onHellEnemyKilled(e, state) {
  if (!e || !state) return;
  if (e.type === "warden") snapAllFuses(state, 1500);
}

/** 敌人死亡后掉魂火；亡魂**不掉**——回路到此为止 */
function spawnSoulfireFor(e, state, level) {
  if (!e || !state || e.isHellRevenant || e.isBoss) return null;
  return dropSoulfire(state, e.x + e.w / 2, e.y + e.h / 2, {
    fuseMs: e.hellFuseMs,
    srcMaxHp: e.maxHp,
    srcW: e.w,
    srcH: e.h,
    level,
  });
}

module.exports = {
  createCinderHusk, createSoulPicker, createBrandBearer, createChainWarden,
  createForgeGullet, createWarden, createRevenant,
  updateHellEnemy, maybeFireHellEnemy, onHellEnemyKilled, spawnSoulfireFor,
};
