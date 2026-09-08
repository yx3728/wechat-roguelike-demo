/**
 * hellVisuals.js
 * ----------------------------------------------------------------------------
 * 地狱的画法只有一条规矩，全部东西都按它走：
 *
 *   **焦黑本体 + 白热轮廓 = 敌人；高饱和 = 危险。**
 *
 * 本体一律低亮度低彩度（旧敌人从没进过这个区间），可读性交给 rimColor 描边；
 * 全图只有三种高饱和色，各自绑死一件事：
 *   #ff3b30 预警与判决 · #ffa000 魂火引信 · #ff6b3d 亡魂与炉火
 * 所以玩家可以只凭"这块有颜色吗"判断要不要躲，不必先认出那是什么。
 * ----------------------------------------------------------------------------
 */
const DANGER = "#ff3b30";
const SOULFIRE = "#ffa000";
const REVENANT = "#ff6b3d";

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ---------------------------------------------------------------------------
// 背景：冷却的渣土地面，光从地缝里透上来
// ---------------------------------------------------------------------------
function drawHellBackground(ctx, state, W, H) {
  const theme = state.theme || {};
  ctx.fillStyle = theme.bg || "#241f2b";
  ctx.fillRect(0, 0, W, H);

  // 渣土裂纹：随波次滚动的横向色带，低对比，只做质感
  const t = state.elapsed || 0;
  ctx.save();
  ctx.strokeStyle = theme.ripple || "#2e2736";
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i += 1) {
    const y = ((i * 74 + t * 0.018) % (H + 120)) - 60;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(-20, y);
    for (let x = -20; x <= W + 20; x += 52) {
      ctx.lineTo(x + 26, y + Math.sin((x + i * 40) * 0.02) * 7);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 地缝：少量白热短线，是这张图唯一的亮部
  ctx.save();
  for (let i = 0; i < 7; i += 1) {
    const seed = i * 137.5;
    const x = (seed * 2.3) % W;
    const y = ((seed * 3.7 + t * 0.026) % (H + 160)) - 80;
    const len = 26 + ((i * 17) % 34);
    const pulse = 0.35 + 0.35 * Math.sin(t * 0.002 + i);
    ctx.globalAlpha = pulse * 0.5;
    ctx.strokeStyle = theme.star || "#c9b8d6";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6, y + len);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 敌人：焦黑填充 + 轮廓光描边
// ---------------------------------------------------------------------------
function silhouette(ctx, e, path) {
  ctx.save();
  ctx.fillStyle = e.color || "#1f1c22";
  ctx.strokeStyle = e.rimColor || "#e8e2d6";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  path();
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** 预警圈：只在 hellAttackPhase === "warn" 时画，红色 = 这一下会疼 */
function warnRing(ctx, e) {
  if (e.hellAttackPhase !== "warn") return;
  const p = clamp(e.hellWarnProgress || 0, 0, 1);
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  ctx.save();
  ctx.strokeStyle = DANGER;
  ctx.globalAlpha = 0.35 + 0.5 * p;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, e.w * 0.7 + (1 - p) * 26, 0, Math.PI * 2);
  ctx.stroke();
  // 指向锁定目标的短线：读得出打哪儿
  if (e.hellTarget) {
    ctx.globalAlpha = 0.25 + 0.45 * p;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(e.hellTarget.x, e.hellTarget.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.3 + 0.5 * p;
    ctx.beginPath();
    ctx.arc(e.hellTarget.x, e.hellTarget.y, 10 + (1 - p) * 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** 业火射线：白热的芯 + 危险色的外缘；收尾时整体变细，读得出"要停了" */
function drawHellBeam(ctx, beam) {
  const life = clamp(beam.ms / Math.max(1, beam.maxMs), 0, 1);
  const taper = life > 0.25 ? 1 : life / 0.25;
  const len = 1400;
  const ex = beam.x + Math.cos(beam.angle) * len;
  const ey = beam.y + Math.sin(beam.angle) * len;
  ctx.save();
  ctx.lineCap = "round";
  // 外缘：判定宽度就是这一层
  ctx.strokeStyle = DANGER;
  ctx.globalAlpha = 0.55 * taper;
  ctx.lineWidth = beam.width * taper;
  ctx.beginPath();
  ctx.moveTo(beam.x, beam.y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  // 芯：白热，比判定窄——不会让玩家以为判定比实际细
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = 0.85 * taper;
  ctx.lineWidth = Math.max(1, beam.width * 0.32 * taper);
  ctx.beginPath();
  ctx.moveTo(beam.x, beam.y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.restore();
}

function drawHellEnemy(ctx, e, state) {
  if (!e || !e.isHell) return false;
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;

  if (e.type === "revenant") {
    const g = clamp(e.hellRiseProgress || 0, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.18 * g;
    ctx.fillStyle = REVENANT;
    ctx.beginPath();
    ctx.arc(cx, cy, e.w * 0.75 + 6 * g, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    silhouette(ctx, e, () => {
      ctx.moveTo(cx, e.y + e.h * (1 - g));
      ctx.lineTo(e.x + e.w, e.y + e.h);
      ctx.lineTo(cx, e.y + e.h * 0.78);
      ctx.lineTo(e.x, e.y + e.h);
    });
    return true;
  }

  if (e.type === "cinderHusk") {
    // 预警：锁死的瞄准线。射线是一条直线，玩家全靠这条线读它落在哪，
    // 所以这里画的是**线**不是圈——圈只说"有事要发生"，线说"事发生在这儿"。
    if (e.hellAttackPhase === "warn" && Number.isFinite(e.hellAimAngle)) {
      const p = clamp(e.hellWarnProgress || 0, 0, 1);
      ctx.save();
      ctx.strokeStyle = DANGER;
      ctx.globalAlpha = 0.25 + 0.45 * p;
      ctx.lineWidth = 2;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -(e.hellAge || 0) * 0.05;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(e.hellAimAngle) * 1400, cy + Math.sin(e.hellAimAngle) * 1400);
      ctx.stroke();
      ctx.restore();
      // 收束的准星：进度条也是倒计时
      ctx.save();
      ctx.strokeStyle = DANGER;
      ctx.globalAlpha = 0.35 + 0.5 * p;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, e.w * 0.55 + (1 - p) * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    silhouette(ctx, e, () => {
      ctx.moveTo(cx, e.y);
      ctx.lineTo(e.x + e.w, e.y + e.h * 0.62);
      ctx.lineTo(cx, e.y + e.h);
      ctx.lineTo(e.x, e.y + e.h * 0.62);
    });
    if (e.hellBeam) drawHellBeam(ctx, e.hellBeam);
    return true;
  }

  if (e.type === "soulPicker") {
    silhouette(ctx, e, () => {
      const r = e.w / 2;
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI * 2 * i) / 6 + (e.hellAge || 0) * 0.002;
        const rr = i % 2 === 0 ? r : r * 0.62;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    });
    if ((e.hellEatFlashMs || 0) > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(e.hellEatFlashMs / 260, 0, 1) * 0.8;
      ctx.strokeStyle = SOULFIRE;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(cx, cy, e.w * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // 抢夺连线：看得见它在跟你抢哪一团
    if (e.hellTarget) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = SOULFIRE;
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(e.hellTarget.x, e.hellTarget.y);
      ctx.stroke();
      ctx.restore();
    }
    return true;
  }

  if (e.type === "brandBearer") {
    silhouette(ctx, e, () => {
      ctx.moveTo(cx, e.y);
      ctx.lineTo(e.x + e.w, e.y + e.h * 0.4);
      ctx.lineTo(e.x + e.w * 0.72, e.y + e.h);
      ctx.lineTo(e.x + e.w * 0.28, e.y + e.h);
      ctx.lineTo(e.x, e.y + e.h * 0.4);
    });
    warnRing(ctx, e);
    return true;
  }

  if (e.type === "chainWarden") {
    silhouette(ctx, e, () => {
      ctx.moveTo(cx, e.y);
      ctx.lineTo(e.x + e.w, e.y + e.h * 0.5);
      ctx.lineTo(cx, e.y + e.h);
      ctx.lineTo(e.x, e.y + e.h * 0.5);
    });
    warnRing(ctx, e);
    return true;
  }

  if (e.type === "forgeGullet") {
    silhouette(ctx, e, () => {
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + e.w, e.y);
      ctx.lineTo(e.x + e.w * 0.78, e.y + e.h);
      ctx.lineTo(e.x + e.w * 0.22, e.y + e.h);
    });
    // 炉口：唯一的亮部，蓄力时变亮
    const glow = e.hellAttackPhase === "warn" ? clamp(e.hellWarnProgress || 0, 0, 1) : 0.12;
    ctx.save();
    ctx.globalAlpha = 0.25 + glow * 0.7;
    ctx.fillStyle = REVENANT;
    ctx.beginPath();
    ctx.ellipse(cx, e.y + e.h * 0.82, e.w * 0.24, e.h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    warnRing(ctx, e);
    return true;
  }

  if (e.type === "warden") {
    // 光环：范围内引信 2× 速烧，必须画得出边界
    if (e.hellWardenAura > 0) {
      ctx.save();
      ctx.globalAlpha = 0.16 + 0.06 * Math.sin((e.hellAge || 0) * 0.005);
      ctx.strokeStyle = SOULFIRE;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.arc(cx, cy, e.hellWardenAura, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    silhouette(ctx, e, () => {
      ctx.moveTo(cx, e.y);
      ctx.lineTo(e.x + e.w, e.y + e.h * 0.3);
      ctx.lineTo(e.x + e.w * 0.82, e.y + e.h);
      ctx.lineTo(e.x + e.w * 0.18, e.y + e.h);
      ctx.lineTo(e.x, e.y + e.h * 0.3);
    });
    return true;
  }

  return false;
}

/** 阎罗：轮廓光的亮度随罪值升高，满罪时白到刺眼——罪值不做独立 UI 条 */
function drawHellBoss(ctx, boss, state) {
  if (!boss || boss.bossVariant !== "yama") return false;
  const cx = boss.x + boss.w / 2, cy = boss.y + boss.h / 2;
  const sin = clamp((Number.isFinite(state && state.hellSin) ? state.hellSin : 20) / 100, 0, 1);
  ctx.save();
  ctx.fillStyle = "#171418";
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = 0.45 + sin * 0.55;
  ctx.lineWidth = 2 + sin * 2.4;
  ctx.beginPath();
  ctx.moveTo(cx, boss.y);
  ctx.lineTo(boss.x + boss.w, boss.y + boss.h * 0.34);
  ctx.lineTo(boss.x + boss.w * 0.80, boss.y + boss.h);
  ctx.lineTo(boss.x + boss.w * 0.20, boss.y + boss.h);
  ctx.lineTo(boss.x, boss.y + boss.h * 0.34);
  ctx.closePath();
  ctx.globalAlpha = 1;
  ctx.fill();
  ctx.globalAlpha = 0.45 + sin * 0.55;
  ctx.stroke();
  ctx.restore();

  if (boss.hellState === "warn") {
    const p = clamp(boss.hellWarnProgress || 0, 0, 1);
    ctx.save();
    ctx.strokeStyle = DANGER;
    ctx.globalAlpha = 0.3 + 0.55 * p;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, boss.w * 0.62 + (1 - p) * 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  return true;
}

// ---------------------------------------------------------------------------
// 覆盖层：魂火、锁链、印记、无间棋盘、业火层数
// ---------------------------------------------------------------------------
function drawHellOverlay(ctx, state, W, H) {
  // 无间预警：3×4 棋盘，安全格不画红
  if (state.hellAviciSafe && (state.hellAviciWarnMs > 0 || state.hellAviciStrikeMs > 0)) {
    const cols = 3, rows = 4, cw = W / cols, ch = H / rows;
    const warnP = state.hellAviciWarnMaxMs
      ? clamp(1 - state.hellAviciWarnMs / state.hellAviciWarnMaxMs, 0, 1) : 1;
    ctx.save();
    for (let c = 0; c < cols; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        const safe = state.hellAviciSafe.some((s) => s.c === c && s.r === r);
        if (safe) {
          ctx.globalAlpha = 0.16;
          ctx.strokeStyle = "#e8e2d6";
          ctx.lineWidth = 2;
          ctx.strokeRect(c * cw + 3, r * ch + 3, cw - 6, ch - 6);
        } else {
          ctx.globalAlpha = 0.10 + warnP * 0.22;
          ctx.fillStyle = DANGER;
          ctx.fillRect(c * cw, r * ch, cw, ch);
        }
      }
    }
    ctx.restore();
  }

  // 烙印使的印记
  (state.enemies || []).forEach((e) => {
    if (!e || !e.hellBrand) return;
    const b = e.hellBrand;
    const p = clamp(1 - b.ms / b.maxMs, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.22 + p * 0.4;
    ctx.fillStyle = DANGER;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * (0.55 + p * 0.45), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.55 + p * 0.4;
    ctx.strokeStyle = DANGER;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  // 锁魂的链子
  if (state.hellChainDraw) {
    const ch = state.hellChainDraw;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "#ded6e8";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(ch.fromX, ch.fromY);
    ctx.lineTo(ch.toX, ch.toY);
    ctx.stroke();
    ctx.restore();
  }

  // 魂火：收缩环 + 中心亮度衰减，两条冗余读数
  (state.hellSoulfires || []).forEach((f) => {
    const frac = clamp(f.fuseMs / Math.max(1, f.fuseMaxMs), 0, 1);
    ctx.save();
    ctx.strokeStyle = f.burning ? REVENANT : SOULFIRE;
    ctx.globalAlpha = 0.35 + 0.5 * frac;
    ctx.lineWidth = f.burning ? 2.6 : 2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 7 + 21 * frac, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.35 + 0.65 * frac;
    ctx.fillStyle = SOULFIRE;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // 镇魂 / 回魂的一次性反馈
  if (state.hellBankFlash) {
    const g = clamp(1 - state.hellBankFlash.ms / 260, 0, 1);
    ctx.save();
    ctx.globalAlpha = (1 - g) * 0.85;
    ctx.strokeStyle = SOULFIRE;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(state.hellBankFlash.x, state.hellBankFlash.y, 10 + 36 * g, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (state.hellRiseFlash) {
    const g = clamp(1 - state.hellRiseFlash.ms / 380, 0, 1);
    ctx.save();
    ctx.globalAlpha = (1 - g) * 0.9;
    ctx.strokeStyle = REVENANT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(state.hellRiseFlash.x, state.hellRiseFlash.y, 6 + 30 * g, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 业火层数：屏幕底部一排小格，满层时整排点亮（「无罪」就绑在满层上）
  const stacks = (state.hellEmber || []).length;
  const max = Math.max(1, state.hellEmberMax || 6);
  if (state.hellReady) {
    const bw = 16, gap = 4, total = max * bw + (max - 1) * gap;
    const x0 = (W - total) / 2, y0 = H - 108;
    ctx.save();
    for (let i = 0; i < max; i += 1) {
      const on = i < stacks;
      ctx.globalAlpha = on ? 0.9 : 0.18;
      ctx.fillStyle = on ? SOULFIRE : "#e8e2d6";
      ctx.fillRect(x0 + i * (bw + gap), y0, bw, 4);
    }
    if (stacks >= max && state.hellAbsolution && (state.hellAbsolutionCdMs || 0) <= 0) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = "#e8e2d6";
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x0 - 4, y0 - 4, total + 8, 12);
    }
    ctx.restore();
  }
}

module.exports = { drawHellBackground, drawHellEnemy, drawHellBoss, drawHellOverlay };
