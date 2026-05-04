/**
 * audio.js
 * ----------------------------------------------------------------------------
 * 背景音乐管理。基于微信小游戏 wx.createInnerAudioContext。
 *
 * 支持两条 BGM：
 *   bgm        菜单 + 第 1/2 波
 *   bossbgm    Boss 战
 *
 * 切歌时使用 pause()/play()，保留播放位置（回菜单后会接着上次的进度继续）。
 *
 * ============================================================================
 *  音频文件放置位置（音频分包）：
 *    wechat-roguelike-demo/subpackages/pkg_audio/audio/audio_bgm_main.mp3
 *    wechat-roguelike-demo/subpackages/pkg_audio/audio/audio_bgm_boss.mp3
 *
 *  支持 mp3 / m4a / wav，路径在下方 BGM_SRC / BOSS_SRC 调整。
 *  如果文件不存在，play() 会静默失败（不会卡死游戏），方便先占位。
 * ============================================================================
 *
 *  调音量：改下方 BGM_VOLUME / BOSS_VOLUME（0~1 之间）。
 */

const BGM_SRC = "subpackages/pkg_audio/audio/audio_bgm_main.mp3";
const BOSS_SRC = "subpackages/pkg_audio/audio/audio_bgm_boss.mp3";
const BGM_VOLUME = 0.4;
const BOSS_VOLUME = 0.5;

let bgm = null;
let bossBgm = null;
let current = null;     // "bgm" | "bossbgm" | null
let enabled = true;     // 全局静音开关（预留接口，目前未使用）
let volumeMul = 1;      // 全局音量倍率（0~1）

function applyVolumes() {
  if (bgm) bgm.volume = BGM_VOLUME * volumeMul;
  if (bossBgm) bossBgm.volume = BOSS_VOLUME * volumeMul;
}

function makeCtx(src, volume) {
  if (typeof wx === "undefined" || typeof wx.createInnerAudioContext !== "function") {
    return null;
  }
  try {
    const ctx = wx.createInnerAudioContext();
    ctx.src = src;
    ctx.loop = true;
    ctx.volume = volume;
    ctx.autoplay = false;
    // 资源不存在时的错误回调，只为防止控制台噪音
    ctx.onError(() => {});
    return ctx;
  } catch (e) {
    return null;
  }
}

function ensureContexts() {
  if (!bgm) bgm = makeCtx(BGM_SRC, BGM_VOLUME);
  if (!bossBgm) bossBgm = makeCtx(BOSS_SRC, BOSS_VOLUME);
  applyVolumes();
}

function safePlay(ctx) {
  if (!ctx) return;
  try { ctx.play(); } catch (e) {}
}
function safePause(ctx) {
  if (!ctx) return;
  try { ctx.pause(); } catch (e) {}
}
function safeStop(ctx) {
  if (!ctx) return;
  try { ctx.stop(); } catch (e) {}
}
function safeSeek(ctx, sec) {
  if (!ctx || typeof ctx.seek !== "function") return;
  try { ctx.seek(sec); } catch (e) {}
}

/** 切到普通 BGM（菜单 + 第 1/2 波） */
function playBgm() {
  ensureContexts();
  if (!enabled) return;
  if (current === "bgm") {
    safePlay(bgm); // 已经是 bgm，但可能被 pause 过；保险起见再 play 一次
    return;
  }
  safePause(bossBgm);
  safePlay(bgm);
  current = "bgm";
}

/** 切到 Boss BGM（Boss 战） */
function playBossBgm() {
  ensureContexts();
  if (!enabled) return;
  // 强制从头播放，避免沿用上一次进度
  safeSeek(bossBgm, 0);
  if (current === "bossbgm") {
    safePlay(bossBgm);
    return;
  }
  safePause(bgm);
  safePlay(bossBgm);
  current = "bossbgm";
}

/** 全部暂停（保留位置） */
function pauseAll() {
  safePause(bgm);
  safePause(bossBgm);
}

/** 全部停止（重置到开头） */
function stopAll() {
  safeStop(bgm);
  safeStop(bossBgm);
  current = null;
}

/** 静音开关（true=允许播放） */
function setEnabled(v) {
  enabled = !!v;
  if (!enabled) pauseAll();
}

function getEnabled() {
  return enabled;
}

/** 设置全局音量倍率（0~1） */
function setVolume(v) {
  const n = Number(v);
  volumeMul = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  applyVolumes();
}

function getVolume() {
  return volumeMul;
}

module.exports = {
  playBgm,
  playBossBgm,
  pauseAll,
  stopAll,
  setEnabled,
  getEnabled,
  setVolume,
  getVolume,
};
