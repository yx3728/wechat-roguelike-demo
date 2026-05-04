/**
 * game.js
 * ============================================================================
 * 微信小游戏入口文件。
 *
 * 职责：
 *   1. 创建上屏 canvas 并按 DPR 缩放，保证高清渲染
 *   2. 维护一个 currentScene，路由"菜单 ↔ 战斗"
 *   3. 注册全局触摸事件，把屏幕坐标转发给当前场景
 *   4. 用 requestAnimationFrame 跑主循环，每帧调用场景的 update / draw
 *
 * 场景接口（每个 scene 实现以下方法）：
 *   update(delta)       推进逻辑，delta 为本帧时长（毫秒）
 *   draw(ctx)           渲染到 canvas
 *   onTouchStart(t)     t = { x, y, id }
 *   onTouchMove(t)
 *   onTouchEnd()
 *
 * 微信小游戏 API 注意：
 *   - requestAnimationFrame 是全局函数（不是 canvas 上的方法）
 *   - wx.onTouchStart 等也是全局监听，touch.clientX / clientY 是逻辑像素坐标
 * ============================================================================
 */

const { W, H, DPR } = require("./src/config.js");
const { createMenuScene } = require("./src/menu.js");
const { createBattleScene } = require("./src/battle.js");
const { CHARACTERS } = require("./src/characters.js");
const storage = require("./src/storage.js");

// ----------------------------------------------------------------------------
// 创建 canvas 与 2D 上下文
// ----------------------------------------------------------------------------
const canvas = wx.createCanvas();         // 第一次调用返回上屏 canvas
const ctx = canvas.getContext("2d");

// 物理像素 = 逻辑像素 * DPR；ctx.scale 之后绘图按逻辑像素写代码就行
canvas.width = Math.floor(W * DPR);
canvas.height = Math.floor(H * DPR);
ctx.scale(DPR, DPR);

// ----------------------------------------------------------------------------
// 场景路由
// ----------------------------------------------------------------------------
let currentScene = null;
const DEFAULT_CHARACTER = CHARACTERS[0];
const BOOT_SUBPACKAGES = ["pkg_audio", "pkg_assets", "pkg_boss"];
const PACKAGE_LABELS = {
  pkg_audio: "音频资源",
  pkg_assets: "贴图资源",
  pkg_boss: "Boss AI",
};
const loadingState = {
  active: true,
  progress: 0,
  currentName: "初始化",
  animMs: 0,
};

function resolveBootCharacter() {
  const save = storage.get();
  const cid = save && save.selectedCharacterId;
  if (!cid) return DEFAULT_CHARACTER;
  const found = CHARACTERS.find((c) => c && c.id === cid);
  return found || DEFAULT_CHARACTER;
}

function goMenu() {
  currentScene = createMenuScene({
    onStart(character, debug) {
      goBattle(character, debug);
    },
  });
}

function goBattle(character, debug) {
  if (character && character.id) storage.setSelectedCharacterId(character.id);
  currentScene = createBattleScene({
    character,
    debug: debug || null,
    // 战斗结束时由 battle.js 调用：result.restart=true 直接重开同角色
    onExit(result) {
      if (result && result.restart && result.character) {
        goBattle(result.character, debug);
      } else {
        goMenu();
      }
    },
  });
}

function loadSubpackageByName(name, onProgress, done) {
  if (!name || typeof wx === "undefined" || typeof wx.loadSubpackage !== "function") {
    done && done();
    return;
  }
  try {
    const task = wx.loadSubpackage({
      name,
      success() {
        onProgress && onProgress(1);
        done && done();
      },
      fail() {
        // 分包加载失败时不阻塞游戏启动，避免设备兼容问题导致黑屏
        onProgress && onProgress(1);
        done && done();
      },
    });
    if (task && typeof task.onProgressUpdate === "function") {
      task.onProgressUpdate((res) => {
        const p = Math.max(0, Math.min(1, (res && res.progress ? res.progress : 0) / 100));
        onProgress && onProgress(p);
      });
    }
  } catch (e) {
    done && done();
  }
}

function preloadBootSubpackages(done) {
  let idx = 0;
  function next() {
    if (idx >= BOOT_SUBPACKAGES.length) {
      done && done();
      return;
    }
    const packageIndex = idx;
    const name = BOOT_SUBPACKAGES[idx++];
    loadingState.currentName = PACKAGE_LABELS[name] || name;
    loadSubpackageByName(
      name,
      (localProgress) => {
        const base = packageIndex / BOOT_SUBPACKAGES.length;
        const span = 1 / BOOT_SUBPACKAGES.length;
        loadingState.progress = Math.max(
          loadingState.progress,
          Math.min(1, base + span * localProgress)
        );
      },
      next
    );
  }
  next();
}

function drawLoadingScreen(delta) {
  loadingState.animMs += delta;
  const t = loadingState.animMs;
  const dots = ".".repeat(1 + Math.floor(t / 350) % 3);
  const p = Math.max(0, Math.min(1, loadingState.progress));

  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, W, H);

  const panelW = Math.min(360, W - 52);
  const panelH = 120;
  const panelX = (W - panelW) / 2;
  const panelY = (H - panelH) / 2;
  const barX = panelX + 24;
  const barY = panelY + 62;
  const barW = panelW - 48;
  const barH = 12;

  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`加载中${dots}`, barX, panelY + 34);

  ctx.fillStyle = "rgba(15, 23, 42, 1)";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = "#22d3ee";
  ctx.fillRect(barX, barY, barW * p, barH);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px sans-serif";
  ctx.fillText(
    `${loadingState.currentName}  ${Math.floor(p * 100)}%`,
    barX,
    panelY + 96
  );
}

// 启动时按存档中“上一把角色”直接开打；缺失时回落默认角色
preloadBootSubpackages(() => {
  loadingState.progress = 1;
  loadingState.active = false;
  goBattle(resolveBootCharacter());
});

// ----------------------------------------------------------------------------
// 主循环
// ----------------------------------------------------------------------------
let lastTs = 0;
function loop(ts) {
  const last = lastTs || ts;
  // delta 上限 48ms：避免切后台回前台时一帧步进过大
  const delta = Math.min(48, ts - last);
  lastTs = ts;
  if (currentScene) {
    currentScene.update(delta);
    currentScene.draw(ctx);
  } else if (loadingState.active) {
    drawLoadingScreen(delta);
  }
  requestAnimationFrame(loop);
}

// ----------------------------------------------------------------------------
// 触摸事件转发
// ----------------------------------------------------------------------------
wx.onTouchStart((e) => {
  const t = e.touches[0];
  if (!t || !currentScene) return;
  currentScene.onTouchStart({ x: t.clientX, y: t.clientY, id: t.identifier });
});

wx.onTouchMove((e) => {
  const t = e.touches[0];
  if (!t || !currentScene) return;
  currentScene.onTouchMove({ x: t.clientX, y: t.clientY, id: t.identifier });
});

wx.onTouchEnd(() => {
  if (currentScene) currentScene.onTouchEnd();
});

wx.onTouchCancel(() => {
  if (currentScene) currentScene.onTouchEnd();
});

requestAnimationFrame(loop);
