/**
 * mechanics.js
 * ----------------------------------------------------------------------------
 * 地图玩法机制注册表。
 *
 * 目的：让「加一个新玩法机制」是**加一项**，而不是往 battle.js 里再塞一段
 * 专属状态 + 专属 update + 专属绘制 + 专属 DEV 开关。
 *
 * 每个机制声明：
 *   id       机制 id；地图在 maps.js 的 mechanics 里按 id 引用并给配置
 *   name     DEV 控制台里显示的名字
 *   fields   该机制往 battle state 里写的字段默认值（开局时统一铺进 state）
 *   devModes DEV 控制台可强制的档位；null 表示该机制不提供 DEV 开关
 *   update(state, dt, cfg)   每帧推进（已保证 cfg 存在）
 *   applyDev(state, mode, cfg)  DEV 强制态生效时怎么写 state；返回 true 表示
 *                               本帧已完全接管，update 不再执行
 *
 * 约定：机制只读写自己 fields 里声明的 state 字段，其余交给 battle.js。
 * ----------------------------------------------------------------------------
 */

/** 沙暴：周期性风险窗口（平静 → 预警 → 沙暴 → 平静…） */
const sandstorm = {
  id: "sandstorm",
  name: "沙暴",
  devModes: [
    { v: "auto", label: "正常周期" },
    { v: "on", label: "强制常驻" },
    { v: "off", label: "强制关闭" },
  ],
  fields: {
    sandstormPhase: "calm",
    sandstormTimerMs: 0,
    sandstormActive: false,
    sandstormAlpha: 0,
    sandstormVisionR: 0,
    sandstormMoveMul: 1,
    sandstormAimSpreadDeg: 0,
    sandstormWarnPulse: 0,
  },

  applyDev(state, mode, cfg) {
    if (mode === "on") {
      state.sandstormPhase = "active";
      state.sandstormActive = true;
      state.sandstormWarnPulse = 0;
      state.sandstormAlpha = cfg.maxAlpha;
      state.sandstormVisionR = cfg.visionR;
      state.sandstormMoveMul = cfg.enemyMoveMul || 1;
      state.sandstormAimSpreadDeg = cfg.aimSpreadDeg || 0;
      return true;
    }
    if (mode === "off") {
      state.sandstormPhase = "calm";
      state.sandstormActive = false;
      state.sandstormWarnPulse = 0;
      state.sandstormAlpha = 0;
      state.sandstormVisionR = 0;
      state.sandstormMoveMul = 1;
      state.sandstormAimSpreadDeg = 0;
      return true;
    }
    return false;
  },

  update(state, dt, cfg) {
    // Boss 战：常规循环停摆并快速退场，交给 Boss 招式主动召唤
    if (state.mechanicsSuspended) {
      state.sandstormPhase = "calm";
      state.sandstormTimerMs = 0;
      state.sandstormActive = false;
      state.sandstormWarnPulse = 0;
      state.sandstormAlpha = Math.max(0, state.sandstormAlpha - (dt / 500) * cfg.maxAlpha);
      state.sandstormMoveMul = 1;
      state.sandstormAimSpreadDeg = 0;
      state.sandstormVisionR = state.sandstormAlpha > 0 ? cfg.visionR : 0;
      return;
    }

    state.sandstormTimerMs += dt;
    const phaseMs = state.sandstormPhase === "calm" ? cfg.calmMs
      : state.sandstormPhase === "warn" ? cfg.warnMs
      : cfg.activeMs * (state.stormDurationMul || 1);
    if (state.sandstormTimerMs >= phaseMs) {
      state.sandstormTimerMs -= phaseMs;
      state.sandstormPhase = state.sandstormPhase === "calm" ? "warn"
        : state.sandstormPhase === "warn" ? "active"
        : "calm";
    }

    const active = state.sandstormPhase === "active";
    state.sandstormActive = active;
    state.sandstormMoveMul = active ? (cfg.enemyMoveMul || 1) : 1;
    state.sandstormAimSpreadDeg = active ? (cfg.aimSpreadDeg || 0) : 0;
    state.sandstormWarnPulse = state.sandstormPhase === "warn"
      ? 0.5 + 0.5 * Math.sin(state.elapsed * 0.012)
      : 0;

    const target = active ? cfg.maxAlpha : 0;
    const rate = active ? (dt / 900) * cfg.maxAlpha : (dt / 700) * cfg.maxAlpha;
    if (state.sandstormAlpha < target) state.sandstormAlpha = Math.min(target, state.sandstormAlpha + rate);
    else if (state.sandstormAlpha > target) state.sandstormAlpha = Math.max(target, state.sandstormAlpha - rate);

    state.sandstormVisionR = state.sandstormAlpha > 0 ? cfg.visionR : 0;
  },
};

/** 潮汐：可预判、交替方向的海流；Boss 战仍保留周期，让海洋构筑持续生效。 */
const tide = {
  id: "tide",
  name: "潮汐",
  devModes: [
    { v: "auto", label: "正常周期" },
    { v: "on", label: "强制涨潮" },
    { v: "off", label: "强制平潮" },
  ],
  fields: {
    tidePhase: "calm",
    tideTimerMs: 0,
    tideActive: false,
    tideDirection: 1,
    tideAlpha: 0,
    tideWarnPulse: 0,
    // 海洋专属海克斯；战斗层负责伤害、拾取、推流以及涨退潮边沿效果。
    tideFireRateMul: 1,
    tideExpMul: 1,
    tideDriftMul: 1,
    tideEndHealRatio: 0,
    tideDamageMul: 1,
    tideEnemyBulletSpeedMul: 1,
    tideHeart: false,
    tideHeartShieldRatio: 0,
  },

  applyDev(state, mode) {
    if (mode !== "on" && mode !== "off") return false;
    state.tidePhase = mode === "on" ? "active" : "calm";
    state.tideActive = mode === "on";
    state.tideTimerMs = 0;
    state.tideAlpha = state.tideActive ? 1 : 0;
    state.tideWarnPulse = 0;
    return true;
  },

  update(state, dt, cfg) {
    const step = Math.max(0, Number(dt) || 0);
    const durations = {
      calm: Math.max(1, Number(cfg.calmMs) || 14000),
      warn: Math.max(1, Number(cfg.warnMs) || 2200),
      active: Math.max(1, Number(cfg.activeMs) || 8000),
    };
    state.tideTimerMs += step;
    // 保留跨阶段的余量；海流在退潮时换向，预警从一开始就给出下次方向。
    while (state.tideTimerMs >= durations[state.tidePhase]) {
      state.tideTimerMs -= durations[state.tidePhase];
      if (state.tidePhase === "calm") state.tidePhase = "warn";
      else if (state.tidePhase === "warn") state.tidePhase = "active";
      else {
        state.tidePhase = "calm";
        state.tideDirection = -state.tideDirection;
      }
    }
    state.tideActive = state.tidePhase === "active";
    state.tideWarnPulse = state.tidePhase === "warn"
      ? 0.5 + 0.5 * Math.sin((state.elapsed || 0) * 0.013)
      : 0;
    const target = state.tideActive ? 1 : 0;
    if (state.tideAlpha < target) state.tideAlpha = Math.min(target, state.tideAlpha + step / 700);
    else if (state.tideAlpha > target) state.tideAlpha = Math.max(target, state.tideAlpha - step / 900);
  },
};

const { grasslandHabitat } = require("./grasslandMechanics.js");

const MECHANICS = [sandstorm, tide, grasslandHabitat];

function getMechanic(id) {
  for (let i = 0; i < MECHANICS.length; i += 1) {
    if (MECHANICS[i].id === id) return MECHANICS[i];
  }
  return null;
}

/** 所有机制的默认字段并成一个对象，开局时铺进 battle state */
function mechanicDefaults() {
  const out = {};
  MECHANICS.forEach((m) => Object.assign(out, m.fields || {}));
  return out;
}

module.exports = {
  MECHANICS,
  getMechanic,
  mechanicDefaults,
};
