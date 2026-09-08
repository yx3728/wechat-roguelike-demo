/** 海洋敌群：移动、蓄力与开火分离，所有危险动作先锁定目标再给玩家避让时间。 */
const { W, H } = require("./config.js");

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function makeOceanEnemy(type, level, opts) {
  const lv = Math.max(1, Number(level) || 1);
  const hp = (opts.hp + Math.floor(lv / opts.hpGrowth)) * 1000;
  return Object.assign({
    type,
    isOcean: true,
    x: 12 + Math.random() * Math.max(1, W - opts.w - 24),
    y: -opts.h - 12,
    hp,
    maxHp: hp,
    vx: 0,
    exp: 8,
    coin: 1,
    fireCooldown: 1800,
    oceanAge: 0,
    oceanPulse: 0,
    oceanWarnProgress: 0,
    oceanAimAngle: Math.PI / 2,
    oceanAttackPhase: "approach",
    oceanVolley: 0,
    // 禁用 battle.js 在 30 秒后补的通用单发；专属 maybeFire 仍正常工作。
    neverFires: true,
  }, opts, { hp, maxHp: hp });
}

function createReefRay(level) {
  return makeOceanEnemy("reefRay", level, {
    color: "#67e8f9", w: 34, h: 25, hp: 1, hpGrowth: 4,
    speed: 1.45, vx: Math.random() < 0.5 ? -1.7 : 1.7,
    oceanTurnMs: 620, exp: 7,
  });
}

function createNeedlefish(level) {
  return makeOceanEnemy("needlefish", level, {
    color: "#fb923c", w: 18, h: 38, hp: 1, hpGrowth: 3,
    speed: 2.3, oceanHoldY: H * (0.15 + Math.random() * 0.13),
    exp: 8,
  });
}

function createJellyfish(level) {
  return makeOceanEnemy("jellyfish", level, {
    color: "#f0abfc", w: 31, h: 35, hp: 2, hpGrowth: 4,
    speed: 0.62, fireInterval: 2700, fireCooldown: 1500,
    oceanFloatPhase: Math.random() * Math.PI * 2, exp: 15, coin: 2,
  });
}

function createArmoredCrab(level) {
  return makeOceanEnemy("armoredCrab", level, {
    color: "#fda4af", w: 42, h: 31, hp: 3, hpGrowth: 2,
    speed: 0.82, vx: Math.random() < 0.5 ? -1.2 : 1.2,
    oceanShellOpen: false, oceanShellTimer: 1800, damageTakenMul: 0.6,
    exp: 28, coin: 5,
  });
}

function createInkCuttlefish(level) {
  return makeOceanEnemy("inkCuttlefish", level, {
    color: "#c4b5fd", w: 29, h: 40, hp: 3, hpGrowth: 3,
    speed: 1.15, fireInterval: 2900, fireCooldown: 1300,
    oceanHoldY: H * (0.18 + Math.random() * 0.12), exp: 16, coin: 2,
  });
}

function createAbyssalAngler(level) {
  const enemy = makeOceanEnemy("abyssalAngler", level, {
    color: "#bef264", w: 64, h: 58, hp: 50, hpGrowth: 2,
    speed: 1.15, fireInterval: 2200, fireCooldown: 1200,
    oceanHoldY: H * 0.22, exp: 40, coin: 8, isElite: true,
  });
  enemy.hp = enemy.maxHp = (50 + Math.floor(Math.max(1, Number(level) || 1) * 0.7)) * 1000;
  return enemy;
}

function lockAim(enemy, state) {
  const p = state && state.player;
  const px = p ? p.x + p.w / 2 : W / 2;
  const py = p ? p.y + p.h / 2 : H * 0.85;
  enemy.oceanAimAngle = Math.atan2(py - enemy.y - enemy.h / 2, px - enemy.x - enemy.w / 2);
}

function beginWarning(enemy, state, ms) {
  lockAim(enemy, state);
  enemy.oceanAttackPhase = "warn";
  enemy.oceanWarnMs = ms;
  enemy.oceanWarnTimer = ms;
  enemy.oceanWarnProgress = 0;
}

function updateOceanEnemy(enemy, delta, state) {
  const step = Math.min(3, Math.max(0, delta) / 16.667);
  enemy.oceanAge += delta;
  enemy.oceanPulse = 0.5 + Math.sin(enemy.oceanAge * 0.005) * 0.5;

  if (enemy.type === "reefRay") {
    // 尖锐的折返与短暂滑翔，区别于星空的连续正弦摆动。
    enemy.oceanTurnMs -= delta;
    if (enemy.oceanTurnMs <= 0) {
      enemy.oceanTurnMs = 620;
      enemy.vx *= -1;
    }
    enemy.x += enemy.vx * (enemy.oceanTurnMs < 180 ? 0.3 : 1) * step;
    enemy.y += enemy.speed * step;
  } else if (enemy.type === "needlefish") {
    if (enemy.oceanAttackPhase === "approach") {
      enemy.y += enemy.speed * step;
      if (enemy.y >= enemy.oceanHoldY) beginWarning(enemy, state, 720);
    } else if (enemy.oceanAttackPhase === "warn") {
      enemy.oceanWarnTimer -= delta;
      enemy.oceanWarnProgress = clamp(1 - enemy.oceanWarnTimer / enemy.oceanWarnMs, 0, 1);
      if (enemy.oceanWarnTimer <= 0) {
        enemy.oceanAttackPhase = "dash";
        enemy.oceanDashMs = 470;
      }
    } else if (enemy.oceanAttackPhase === "dash") {
      enemy.x += Math.cos(enemy.oceanAimAngle) * 8.4 * step;
      enemy.y += Math.sin(enemy.oceanAimAngle) * 8.4 * step;
      enemy.oceanDashMs -= delta;
      if (enemy.oceanDashMs <= 0) enemy.oceanAttackPhase = "recover";
    } else {
      enemy.y += 1.8 * step;
    }
  } else if (enemy.type === "armoredCrab") {
    // 合壳横移、开壳停步；开壳后伤害放大，构筑爆发有明确时机。
    enemy.oceanShellTimer -= delta;
    if (enemy.oceanShellTimer <= 0) {
      enemy.oceanShellOpen = !enemy.oceanShellOpen;
      enemy.oceanShellTimer = enemy.oceanShellOpen ? 1000 : 1800;
      enemy.damageTakenMul = enemy.oceanShellOpen ? 1.35 : 0.6;
      if (!enemy.oceanShellOpen) enemy.vx *= -1;
    }
    enemy.oceanAttackPhase = enemy.oceanShellOpen ? "recover" : "approach";
    enemy.x += enemy.vx * (enemy.oceanShellOpen ? 0 : 1) * step;
    enemy.y += enemy.speed * (enemy.oceanShellOpen ? 0.25 : 1) * step;
  } else if (enemy.type === "jellyfish") {
    enemy.oceanFloatPhase += delta * 0.0018;
    enemy.x += Math.sin(enemy.oceanFloatPhase) * 0.38 * step;
    enemy.y += enemy.speed * (enemy.oceanAttackPhase === "warn" ? 0.15 : 1) * step;
  } else if (enemy.type === "inkCuttlefish" || enemy.type === "abyssalAngler") {
    if (enemy.y < enemy.oceanHoldY) {
      enemy.y += enemy.speed * step;
    } else if (enemy.oceanAttackPhase !== "warn" && enemy.oceanAttackPhase !== "volley") {
      const drift = enemy.type === "abyssalAngler" ? 1.05 : 0.5;
      enemy.x += Math.sin(enemy.oceanAge * 0.0012) * drift * step;
    }
    // 墨鱼每次喷射后反向后退，避免静止炮台的手感。
    if (enemy.oceanRecoilMs > 0) {
      enemy.y -= 0.8 * step;
      enemy.oceanRecoilMs = Math.max(0, enemy.oceanRecoilMs - delta);
    }
  }

  if (enemy.type !== "needlefish" || enemy.oceanAttackPhase !== "dash") {
    if (enemy.x <= 4 || enemy.x + enemy.w >= W - 4) enemy.vx *= -1;
    enemy.x = clamp(enemy.x, 4, Math.max(4, W - enemy.w - 4));
  }
}

function oceanShot(enemy, fireFn, angle, speed, size, color) {
  fireFn({
    x: enemy.x + enemy.w / 2 - size / 2,
    y: enemy.y + enemy.h / 2 - size / 2,
    w: size, h: size,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    dmg: 1, color, oceanBullet: true,
  });
}

function fireOceanVolley(enemy, fireFn) {
  if (enemy.type === "jellyfish") {
    // 八向疏环；每轮偏转半个扇区，近身外圈仍留足穿越宽度。
    const base = enemy.oceanVolley % 2 ? Math.PI / 8 : 0;
    for (let i = 0; i < 8; i += 1) oceanShot(enemy, fireFn, base + i * Math.PI / 4, 2.2, 7, "#f0abfc");
  } else if (enemy.type === "inkCuttlefish") {
    [-0.18, 0, 0.18].forEach((off) => oceanShot(enemy, fireFn, enemy.oceanAimAngle + off, 3.1, 8, "#c4b5fd"));
    enemy.oceanRecoilMs = 180;
  } else {
    // 灯笼诱导双颚：瞄准线中间留 0.4 弧度的安全扇区，向两侧张口。
    [-0.66, -0.43, -0.22, 0.22, 0.43, 0.66].forEach((off) => {
      oceanShot(enemy, fireFn, enemy.oceanAimAngle + off, 2.7 + enemy.oceanVolley * 0.08, 8, "#bef264");
    });
  }
  enemy.oceanVolley += 1;
}

function maybeFireOceanEnemy(enemy, delta, state, fireFn) {
  if (enemy.type !== "jellyfish" && enemy.type !== "inkCuttlefish" && enemy.type !== "abyssalAngler") return;
  if (enemy.y < 55) return;

  if (enemy.oceanAttackPhase === "warn") {
    enemy.oceanWarnTimer -= delta;
    enemy.oceanWarnProgress = clamp(1 - enemy.oceanWarnTimer / enemy.oceanWarnMs, 0, 1);
    if (enemy.oceanWarnTimer > 0) return;
    enemy.oceanAttackPhase = "volley";
    enemy.oceanVolley = 0;
    enemy.oceanVolleyTimer = 0;
  }

  if (enemy.oceanAttackPhase === "volley") {
    enemy.oceanVolleyTimer -= delta;
    if (enemy.oceanVolleyTimer > 0) return;
    fireOceanVolley(enemy, fireFn);
    const count = enemy.type === "jellyfish" ? 1 : 3;
    enemy.oceanVolleyTimer = enemy.type === "abyssalAngler" ? 350 : 230;
    if (enemy.oceanVolley >= count) {
      enemy.oceanAttackPhase = "recover";
      enemy.oceanWarnProgress = 0;
      enemy.fireCooldown = enemy.fireInterval;
      if (enemy.isElite) enemy.damageTakenMul = 1.4;
    }
    return;
  }

  enemy.fireCooldown -= delta;
  if (enemy.fireCooldown > 0) return;
  enemy.damageTakenMul = 1;
  beginWarning(enemy, state, enemy.isElite ? 850 : 650);
}

module.exports = {
  createReefRay,
  createNeedlefish,
  createJellyfish,
  createArmoredCrab,
  createInkCuttlefish,
  createAbyssalAngler,
  updateOceanEnemy,
  maybeFireOceanEnemy,
};
