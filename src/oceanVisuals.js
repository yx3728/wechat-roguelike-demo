/**
 * 海洋专属 Canvas 视觉。只有绘制，不改战斗数据，不加载贴图。
 * 背景 → drawOceanOverlay（场地预警）→ 子弹/角色 → drawOceanEnemy。
 * 暖珊瑚色始终表示敌方；海床低对比、装饰收在两侧，给弹幕留出暗色通道。
 */

const TAU = Math.PI * 2;
const OCEAN_TYPES = {
  reefRay: true,
  needlefish: true,
  jellyfish: true,
  armoredCrab: true,
  inkCuttlefish: true,
  abyssalAngler: true,
};

function clamp01(n) { return Math.max(0, Math.min(1, n || 0)); }

function blendHex(a, b, t) {
  const av = parseInt((a || "#031c2a").slice(1), 16);
  const bv = parseInt((b || a || "#031c2a").slice(1), 16);
  const k = clamp01(t);
  const r = Math.round(((av >> 16) & 255) * (1 - k) + ((bv >> 16) & 255) * k);
  const g = Math.round(((av >> 8) & 255) * (1 - k) + ((bv >> 8) & 255) * k);
  const bl = Math.round((av & 255) * (1 - k) + (bv & 255) * k);
  return `rgb(${r},${g},${bl})`;
}

function themeColor(state, key, fallback) {
  const current = state.theme || {};
  const from = state.themeFrom || current;
  const to = state.themeTo || current;
  return blendHex(from[key] || fallback, to[key] || fallback, state.themeBlendT == null ? 1 : state.themeBlendT);
}

function ellipse(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function polygon(ctx, pts, fill, stroke, width) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width || 3;
    ctx.stroke();
  }
}

/** Bounded deterministic detail: no per-frame random arrays or particle state. */
function drawOceanBackground(ctx, state, W, H) {
  const t = state.elapsed || 0;
  const motionT = state.flashEffectsOn === false ? 0 : t;
  const base = themeColor(state, "bg", "#031c2a");
  const shallow = themeColor(state, "surface", "#07485a");
  const deep = themeColor(state, "deep", "#020b19");
  const reef = themeColor(state, "reef", "#0c3c48");
  const caustic = themeColor(state, "ripple", "#2b8490");
  ctx.save();
  const depth = ctx.createLinearGradient(0, 0, W * 0.45, H);
  depth.addColorStop(0, shallow);
  depth.addColorStop(0.35, base);
  depth.addColorStop(1, deep);
  ctx.fillStyle = depth;
  ctx.fillRect(0, 0, W, H);

  // 斜落的宽光束：低透明，不做高频亮闪；越往深处越稀薄。
  ctx.globalAlpha = 0.055;
  const shaft = ctx.createLinearGradient(0, 0, 0, H * 0.8);
  shaft.addColorStop(0, "#a6eee0");
  shaft.addColorStop(1, "rgba(80,160,160,0)");
  ctx.fillStyle = shaft;
  for (let i = 0; i < 4; i += 1) {
    const x = W * (i * 0.28 - 0.35) + Math.sin(motionT * 0.0002 + i) * 16;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + W * 0.09, 0);
    ctx.lineTo(x + W * 0.60, H * 0.8);
    ctx.lineTo(x + W * 0.32, H * 0.8);
    ctx.closePath();
    ctx.fill();
  }

  // 两侧远景海床与狭长海沟；中央保持安静，不与子弹争夺注意力。
  for (let side = 0; side < 2; side += 1) {
    ctx.save();
    ctx.translate(side ? W : 0, 0);
    if (side) ctx.scale(-1, 1);
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = reef;
    ctx.beginPath();
    ctx.moveTo(0, -60);
    for (let j = 0; j <= 9; j += 1) {
      const y = (j / 9) * (H + 120) - 60;
      const x = W * (0.09 + 0.045 * Math.sin(j * 1.77 + side * 2.3));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(0, H + 60);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.11;
    ctx.strokeStyle = caustic;
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let j = 0; j < 5; j += 1) {
      const y = (j * 173 + side * 94 + motionT * 0.012) % (H + 140) - 70;
      const x = 7 + (j % 3) * 9;
      const s = 16 + (j % 3) * 7;
      ctx.globalAlpha = 0.36;
      ellipse(ctx, x, y + 12, s * 1.4, s * 0.67, "#041923");
      ctx.strokeStyle = j % 2 ? "#215565" : "#1d6b69";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y + 9);
      ctx.lineTo(x + 4, y - s);
      ctx.moveTo(x + 3, y - 3);
      ctx.lineTo(x + s * 0.7, y - s * 0.6);
      ctx.lineTo(x + s * 0.85, y - s);
      ctx.moveTo(x + 3, y - s * 0.4);
      ctx.lineTo(x - s * 0.65, y - s * 0.7);
      ctx.stroke();
      ctx.globalAlpha = 0.20;
      dot(ctx, x + s * 0.85, y - s, 2, "#9ed5c1");
    }
    ctx.restore();
  }

  // Slow interlocking caustics. Thin incomplete arcs avoid confusing them with ring attacks.
  ctx.strokeStyle = caustic;
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i += 1) {
    const y = (i * H / 8 + motionT * 0.015) % (H + 100) - 50;
    const sway = Math.sin(motionT * 0.00045 + i * 1.7);
    ctx.globalAlpha = 0.06 + (1 - Math.max(0, y) / H) * 0.05;
    ctx.beginPath();
    ctx.moveTo(-20, y + 14 * sway);
    ctx.bezierCurveTo(W * 0.17, y - 22, W * 0.30, y + 34, W * 0.47, y + sway * 12);
    ctx.moveTo(W * 0.61, y - 20);
    ctx.bezierCurveTo(W * 0.78, y + 14, W * 0.87, y - 25, W + 20, y - 9);
    ctx.stroke();
  }

  // 海雪与气泡只有 22 个；暗色中心与空心轮廓区别于实心敌弹。
  ctx.strokeStyle = "#9bd1d2";
  ctx.lineWidth = 0.75;
  for (let i = 0; i < 22; i += 1) {
    const lane = i % 3;
    const x = (i * 79.7 + Math.sin(motionT * 0.0005 + i * 2.1) * 7 + W) % W;
    const y = (i * 127.1 - motionT * (0.008 + lane * 0.006) + H * 100) % H;
    ctx.globalAlpha = 0.09 + lane * 0.025;
    ctx.beginPath();
    ctx.arc(x, y, 1.1 + lane * 0.6, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawReefRay(ctx, e, t) {
  const flap = Math.sin(t * 0.006 + e.x * 0.08) * 6;
  ctx.strokeStyle = "#d78071";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.quadraticCurveTo(8, -36, -3, -49);
  ctx.stroke();
  ctx.fillStyle = "#963f53";
  ctx.beginPath();
  ctx.moveTo(0, -25);
  ctx.quadraticCurveTo(-17, -14, -49, -27 + flap);
  ctx.quadraticCurveTo(-42, 14, -18, 26);
  ctx.quadraticCurveTo(-8, 29, 0, 44);
  ctx.quadraticCurveTo(8, 29, 18, 26);
  ctx.quadraticCurveTo(42, 14, 49, -27 + flap);
  ctx.quadraticCurveTo(17, -14, 0, -25);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#f69a86";
  ctx.lineWidth = 3.6;
  ctx.stroke();
  polygon(ctx, [-31, -8, -13, 3, -5, 23, -23, 10], "#542c48");
  polygon(ctx, [31, -8, 13, 3, 5, 23, 23, 10], "#542c48");
  ellipse(ctx, 0, 0, 8, 26, "#d06b69");
  dot(ctx, -8, 21, 3, "#ffe8ba");
  dot(ctx, 8, 21, 3, "#ffe8ba");
}

function drawNeedlefish(ctx, e) {
  const a = typeof e.oceanAimAngle === "number" ? e.oceanAimAngle : Math.PI / 2;
  // Rotation before drawing in normalized space keeps every fin inside the collision box.
  const visualAngle = Math.atan2(Math.sin(a) / e.h, Math.cos(a) / e.w) - Math.PI / 2;
  ctx.save();
  ctx.rotate(visualAngle);
  polygon(ctx, [0, -45, -13, -28, -6, -25, -9, 8, -24, 22, -6, 18, 0, 48,
    6, 18, 24, 22, 9, 8, 6, -25, 13, -28], "#f1874a", "#ffcd8c", 3);
  polygon(ctx, [0, -30, -4, 13, 0, 33, 4, 13], "#79354a");
  dot(ctx, -5, 13, 2.6, "#fff4d2");
  dot(ctx, 5, 13, 2.6, "#fff4d2");
  ctx.restore();
}

function drawJellyfish(ctx, e, t) {
  const breathe = Math.sin(t * 0.005 + e.x) * 3;
  ctx.strokeStyle = "#df9caf";
  ctx.lineWidth = 3.6;
  ctx.lineCap = "round";
  for (let i = -2; i <= 2; i += 1) {
    const x = i * 12;
    const sway = Math.sin(t * 0.005 + i * 1.2) * 7;
    ctx.beginPath();
    ctx.moveTo(x, 5);
    ctx.bezierCurveTo(x + sway, 18, x - sway, 31, x + sway * 0.7, 46 - Math.abs(i) * 3);
    ctx.stroke();
  }
  ctx.fillStyle = "#6f497c";
  ctx.strokeStyle = "#f2adcb";
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(-43, 9);
  ctx.bezierCurveTo(-43 - breathe, -49, 43 + breathe, -49, 43, 9);
  ctx.quadraticCurveTo(32, 20, 21, 9);
  ctx.quadraticCurveTo(11, 20, 0, 9);
  ctx.quadraticCurveTo(-11, 20, -21, 9);
  ctx.quadraticCurveTo(-32, 20, -43, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ellipse(ctx, 0, -9, 16 + breathe, 17 - breathe, "#ad7094");
  dot(ctx, 0, -9, 6, "#ffe1c2");
  ctx.strokeStyle = "#d2a0c1";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-29, -4);
  ctx.quadraticCurveTo(-24, -25, -11, -28);
  ctx.stroke();
}

function drawArmoredCrab(ctx, e, t) {
  const step = Math.sin(t * 0.009 + e.x) * 3;
  const open = !!e.oceanShellOpen;
  ctx.strokeStyle = "#ce8866";
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(s * 24, -6 + i * 10);
      ctx.lineTo(s * 41, -9 + i * 14 + step * (i % 2 ? 1 : -1));
      ctx.lineTo(s * 46, 3 + i * 13);
      ctx.stroke();
    }
    polygon(ctx, [s * 25, 2, s * 46, -18, s * 46, -43, s * 33, -30,
      s * 26, -43, s * 23, -19], "#a65340", "#efb779", 3.5);
  }
  polygon(ctx, [-26, -22, 0, -31, 26, -22, 31, 7, 21, 32, 0, 41, -21, 32, -31, 7],
    "#805440", "#e0ad72", 4);
  if (open) {
    polygon(ctx, [-25, -15, -7, -22, -7, 9, -25, 3], "#b57a50", "#ffd5a0", 2);
    polygon(ctx, [25, -15, 7, -22, 7, 9, 25, 3], "#b57a50", "#ffd5a0", 2);
    ellipse(ctx, 0, -4, 7, 17, "#ffcd83");
  } else {
    polygon(ctx, [-18, -15, 0, -22, 18, -15, 21, 3, 0, 13, -21, 3], "#b57a50");
  }
  polygon(ctx, [-21, 10, -3, 18, -3, 30, -15, 25], "#433844");
  polygon(ctx, [21, 10, 3, 18, 3, 30, 15, 25], "#433844");
  dot(ctx, -10, 30, 3.5, "#ffdd9c");
  dot(ctx, 10, 30, 3.5, "#ffdd9c");
}

function drawInkCuttlefish(ctx, e, t) {
  const sway = Math.sin(t * 0.006 + e.x) * 4;
  ctx.strokeStyle = "#ed91b6";
  ctx.lineWidth = 3.4;
  for (let i = -2; i <= 2; i += 1) {
    const x = i * 9;
    ctx.beginPath();
    ctx.moveTo(x, 13);
    ctx.quadraticCurveTo(x * 1.8 + sway, 28, x * 1.5 - sway, 46 - Math.abs(i) * 5);
    ctx.stroke();
  }
  ctx.fillStyle = "#73355e";
  ctx.strokeStyle = "#d877a4";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(0, -47);
  ctx.bezierCurveTo(-17, -25, -41, -23 + sway, -42, 11);
  ctx.lineTo(-23, 4);
  ctx.quadraticCurveTo(0, 30, 23, 4);
  ctx.lineTo(42, 11);
  ctx.bezierCurveTo(41, -23 - sway, 17, -25, 0, -47);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  polygon(ctx, [0, -34, -12, -8, 0, 10, 12, -8], "#b66b92");
  ellipse(ctx, 0, -9, 4, 14, "#e8a0bb");
  dot(ctx, -14, 10, 5.5, "#f8d7bf");
  dot(ctx, 14, 10, 5.5, "#f8d7bf");
  dot(ctx, -13, 12, 2.5, "#402646");
  dot(ctx, 13, 12, 2.5, "#402646");
}

function drawAngler(ctx, e, t) {
  const pulse = 0.5 + Math.sin(t * 0.005) * 0.5;
  const tailSwing = t ? Math.sin(t * 0.0034 + e.x * 0.01) * 5 : 0;
  // 尾柄连接处固定，摆幅从根部向尾鳍递增；头、嘴与灯饵不随尾巴转动。
  ctx.beginPath();
  ctx.moveTo(-7, -18);
  ctx.quadraticCurveTo(-5 + tailSwing * 0.3, -29, -14 + tailSwing, -47);
  ctx.bezierCurveTo(-6 + tailSwing, -44, 4 + tailSwing, -52, 13 + tailSwing, -47);
  ctx.quadraticCurveTo(5 + tailSwing * 0.3, -29, 7, -18);
  ctx.closePath(); ctx.fillStyle = "#593851"; ctx.fill();
  ctx.strokeStyle = "#cf91a1"; ctx.lineWidth = 2.6; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -19);
  ctx.quadraticCurveTo(tailSwing * 0.3, -31, tailSwing, -46);
  ctx.strokeStyle = "#e0ab9f"; ctx.lineWidth = 1.6; ctx.stroke();
  polygon(ctx, [-22, -20, -46, -28, -42, 6, -24, 22], "#4d3765", "#c2839d", 3);
  polygon(ctx, [22, -20, 46, -28, 42, 6, 24, 22], "#4d3765", "#c2839d", 3);
  ctx.strokeStyle = "#c0aa80";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0, -21);
  ctx.bezierCurveTo(-14, -44, 18, -50, 18, -34);
  ctx.stroke();
  ctx.globalAlpha *= 0.18 + pulse * 0.10;
  dot(ctx, 18, -34, 11 + pulse * 2, "#ffd791");
  ctx.globalAlpha /= 0.18 + pulse * 0.10;
  dot(ctx, 18, -34, 5.2, "#ffe6ad");
  ellipse(ctx, 0, 9, 34, 34, "#574063");
  ctx.strokeStyle = "#d991a3";
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.ellipse(0, 9, 34, 34, 0, 0, TAU);
  ctx.stroke();
  ellipse(ctx, 0, 18, 24, 19, "#130f27");
  for (let i = -2; i <= 2; i += 1) {
    const x = i * 8;
    polygon(ctx, [x - 3, 2 + Math.abs(i) * 2, x + 3, 2 + Math.abs(i) * 2, x, 16], "#f4d7b3");
    polygon(ctx, [x - 3, 32 - Math.abs(i) * 2, x + 3, 32 - Math.abs(i) * 2, x, 22], "#f4d7b3");
  }
  dot(ctx, -19, -4, 5.5, "#ffd594");
  dot(ctx, 19, -4, 5.5, "#ffd594");
  dot(ctx, -19, -3, 2, "#482440");
  dot(ctx, 19, -3, 2, "#482440");
}

function drawLeviathan(ctx, e, t) {
  const phase2 = e.leviathanPhase === 2;
  const swim = t ? (e.leviathanSwimPhase == null ? t * 0.004 : e.leviathanSwimPhase) : 0;
  const windup = e.leviathanState === "warn" ? clamp01(e.leviathanWarnProgress) : 0;
  const thrust = t ? clamp01(e.leviathanThrust || (e.leviathanState === "dash" ? 1 : 0)) : 0;
  const pulse = 0.5 + Math.sin(t * 0.0035) * 0.5;
  const edge = phase2 ? "#ffab82" : "#d99d8a";
  const armor = phase2 ? "#63354e" : "#24535c";
  const fin = phase2 ? "#773f55" : "#244550";
  const core = phase2 ? "#fc846c" : "#b88382";
  ctx.save();
  // 轻微侧倾与呼吸收在碰撞盒内，鳍翼独立摆动；蓄力时收鳍、张口。
  ctx.rotate(t ? (e.leviathanBank || Math.sin(swim * 0.52) * 0.025) : 0);
  ctx.scale(0.92 * (1 + Math.sin(swim) * 0.018 - thrust * 0.025), 0.93 + thrust * 0.025);
  // 巨型侧鳍与锯齿脊甲都收在实际碰撞盒内。
  for (let side = -1; side <= 1; side += 2) {
    const flap = Math.sin(swim + side * 0.7) * 0.16 - windup * 0.23 + thrust * 0.13;
    ctx.save();
    ctx.translate(side * 18, -6);
    ctx.rotate(side * flap);
    ctx.translate(-side * 18, 6);
    ctx.fillStyle = fin;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(side * 17, -25);
    ctx.bezierCurveTo(side * 29, -36, side * 43, -30, side * 47, -22);
    ctx.quadraticCurveTo(side * 34, -8, side * 46, 10);
    ctx.quadraticCurveTo(side * 30, 2, side * 37, 34);
    ctx.bezierCurveTo(side * 19, 22, side * 18, 31, side * 14, 36);
    ctx.lineTo(side * 12, 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = phase2 ? "#ce6c6b" : "#417983";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(side * 22, -14);
    ctx.lineTo(side * 37, -21);
    ctx.moveTo(side * 23, 0);
    ctx.lineTo(side * 39, 8);
    ctx.moveTo(side * 21, 10);
    ctx.lineTo(side * 31, 23);
    ctx.stroke();
    ctx.restore();
  }
  const tail = Math.sin(swim - 0.6) * 5;
  polygon(ctx, [-10, -23, -15 + tail, -41, -5 + tail, -36, tail, -49, 5 + tail, -36, 15 + tail, -41, 10, -23],
    armor, edge, 1.4);
  ctx.fillStyle = armor;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(0, -35);
  ctx.bezierCurveTo(-23, -34, -28, -10, -24, 14);
  ctx.lineTo(-17, 37);
  ctx.lineTo(0, 47);
  ctx.lineTo(17, 37);
  ctx.bezierCurveTo(30, 2, 30, -24, 0, -35);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 分节甲片在二阶段裂开，露出珊瑚红核心；不需要依赖闪屏。
  for (let i = 0; i < 4; i += 1) {
    const y = -25 + i * 9;
    const spread = (phase2 ? 4 : 0) + (t ? (1 + Math.sin(swim - i * 0.65)) * 0.8 : 0) + windup;
    polygon(ctx, [-3 - spread, y, -18, y + 2, -20, y + 9, -4 - spread, y + 6],
      phase2 ? "#923f52" : "#37636b", edge, 0.65);
    polygon(ctx, [3 + spread, y, 18, y + 2, 20, y + 9, 4 + spread, y + 6],
      phase2 ? "#923f52" : "#37636b", edge, 0.65);
  }
  polygon(ctx, [0, -29, -(phase2 ? 4.5 : 2), -10, 0, 10,
    phase2 ? 4.5 : 2, -10], core);
  if (phase2) {
    dot(ctx, 0, -9, 3.2 + pulse, "#ffdab0");
    polygon(ctx, [-17, -26, -25, -39, -19, -13], "#f4b792");
    polygon(ctx, [17, -26, 25, -39, 19, -13], "#f4b792");
  }
  // 双眼与裂开的巨口是正面轮廓的识别点。
  polygon(ctx, [-19, 10, -7, 14, -10, 19, -19, 16], "#ffd4a0");
  polygon(ctx, [19, 10, 7, 14, 10, 19, 19, 16], "#ffd4a0");
  const jawY = (phase2 ? 38 : 33) + windup * 5 + (t ? Math.sin(swim * 0.8) * 1.4 : 0);
  polygon(ctx, [-15, 24, 0, 20, 15, 24, 10, jawY, 0, jawY + 3, -10, jawY], "#140f25", core, 1.2);
  for (let i = -2; i <= 2; i += 1) {
    const x = i * 5;
    polygon(ctx, [x - 1.5, 24, x + 1.5, 24, x, 30 + (phase2 ? 2 : 0)], "#ffdcad");
    polygon(ctx, [x - 1.3, jawY - 1, x + 1.3, jawY - 1, x, jawY - 5], "#ffdcad");
  }
  if ((e.hpBarBreakFlashMs || 0) > 0) {
    ctx.save();
    ctx.globalAlpha *= Math.min(0.65, e.hpBarBreakFlashMs / 650);
    ctx.strokeStyle = "#fff1d1";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(0, 3, 25, 39, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** true means handled; callers still draw their common health bar afterward. */
function drawOceanEnemy(ctx, e, state) {
  if (!e || (!OCEAN_TYPES[e.type] && e.bossVariant !== "leviathan")) return false;
  if (!(e.w > 0 && e.h > 0)) return false;
  const t = state.flashEffectsOn === false ? 0 : (state.elapsed || 0);
  ctx.save();
  ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
  ctx.scale(e.w / 100, e.h / 100);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (e.bossVariant === "leviathan") drawLeviathan(ctx, e, t);
  else if (e.type === "reefRay") drawReefRay(ctx, e, t);
  else if (e.type === "needlefish") drawNeedlefish(ctx, e);
  else if (e.type === "jellyfish") drawJellyfish(ctx, e, t);
  else if (e.type === "armoredCrab") drawArmoredCrab(ctx, e, t);
  else if (e.type === "inkCuttlefish") drawInkCuttlefish(ctx, e, t);
  else drawAngler(ctx, e, t);
  ctx.restore();
  return true;
}

function drawArrow(ctx, x, y, direction, size) {
  ctx.beginPath();
  ctx.moveTo(x - direction * size, y - size * 0.65);
  ctx.lineTo(x, y);
  ctx.lineTo(x - direction * size, y + size * 0.65);
  ctx.stroke();
}

function drawAimWarning(ctx, cx, cy, angle, length, width, progress, endPad) {
  const pad = endPad || 0;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const wash = ctx.createLinearGradient(0, 0, length + pad, 0);
  wash.addColorStop(0, "rgba(255,151,119,0.015)");
  wash.addColorStop(0.55, `rgba(255,151,119,${0.025 + progress * 0.035})`);
  wash.addColorStop(1, `rgba(255,177,128,${0.065 + progress * 0.06})`);
  ctx.fillStyle = wash;
  ctx.fillRect(-pad, -width / 2, length + pad * 2, width);
  const edge = ctx.createLinearGradient(-pad, 0, length + pad, 0);
  edge.addColorStop(0, "rgba(255,195,154,0.05)");
  edge.addColorStop(0.55, "rgba(255,195,154,0.35)");
  edge.addColorStop(1, `rgba(255,218,176,${0.6 + progress * 0.3})`);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-pad, -width / 2);
  ctx.lineTo(length + pad, -width / 2);
  ctx.moveTo(-pad, width / 2);
  ctx.lineTo(length + pad, width / 2);
  ctx.stroke();
  // 空心流向标记沿航道推进，与实心伤害弹区分。
  ctx.lineWidth = 1.15;
  for (let i = 0; i < 3; i += 1) {
    const u = (i / 3 + progress * 0.45) % 1;
    ctx.globalAlpha = 0.2 + Math.sin(u * Math.PI) * 0.45;
    ctx.strokeStyle = "#ffd7ad";
    drawArrow(ctx, length * u, 0, 1, Math.min(7, width * 0.22));
  }
  ctx.restore();
}

function drawTargetBrackets(ctx, x, y, w, h, color) {
  const tick = Math.min(12, w * 0.18, h * 0.18);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      const px = x + sx * w / 2;
      const py = y + sy * h / 2;
      ctx.moveTo(px - sx * tick, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py - sy * tick);
    }
  }
  ctx.stroke();
}

function drawBossWarning(ctx, e, state, W, H) {
  if (e.leviathanState !== "warn") return;
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const p = clamp01(e.leviathanWarnProgress);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,213,170,0.65)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(e.w, e.h) * 0.57, -Math.PI / 2, -Math.PI / 2 + TAU * p);
  ctx.stroke();
  if (e.leviathanAttack === "tideGate") {
    const gap = typeof e.leviathanGapX === "number" ? e.leviathanGapX : W / 2;
    const gapW = e.leviathanGapW || 100;
    const left = Math.max(0, gap - gapW / 2);
    const right = Math.min(W, gap + gapW / 2);
    const y = Math.max(0, e.leviathanWallY == null ? e.y + e.h : e.leviathanWallY);
    const wash = ctx.createLinearGradient(0, y, 0, H);
    wash.addColorStop(0, `rgba(244,115,102,${0.035 + p * 0.045})`);
    wash.addColorStop(1, "rgba(244,115,102,0.005)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, y, left, H - y);
    ctx.fillRect(right, y, W - right, H - y);
    // 安全缺口以两侧窄光带标出，不盖满玩家的整个走位区域。
    for (const boundary of [left, right]) {
      const halo = ctx.createLinearGradient(boundary - 6, 0, boundary + 6, 0);
      halo.addColorStop(0, "rgba(118,220,210,0)");
      halo.addColorStop(0.5, `rgba(118,220,210,${0.1 + p * 0.12})`);
      halo.addColorStop(1, "rgba(118,220,210,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(boundary - 6, y, 12, H - y);
    }
    ctx.strokeStyle = "rgba(177,232,215,0.55)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left, H);
    ctx.moveTo(right, y);
    ctx.lineTo(right, H);
    ctx.stroke();
    for (let row = 0; row < 3; row += 1) {
      ctx.strokeStyle = `rgba(255,183,147,${0.6 - row * 0.17})`;
      ctx.lineWidth = row === 0 ? 1.4 : 0.8;
      const waveY = y + 8 + p * 28 - row * 7;
      for (const [start, end] of [[0, left - 3], [right + 3, W]]) {
        ctx.beginPath();
        for (let x = start; x <= end; x += 4) {
          const yy = waveY + Math.sin(x * 0.045 + p * 4) * 2.5;
          if (x === start) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }
  } else if (e.leviathanAttack === "abyssFan") {
    const aim = typeof e.leviathanAimAngle === "number" ? e.leviathanAimAngle : Math.PI / 2;
    const half = e.leviathanPhase === 2 ? 3 : 2;
    const spread = half * 0.23;
    const length = Math.max(W, H) * 1.3;
    ctx.lineWidth = 0.85;
    for (let i = -half; i <= half; i += 1) {
      const a = aim + i * 0.23;
      const ray = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * length, cy + Math.sin(a) * length);
      ray.addColorStop(0, `rgba(255,205,166,${0.48 + p * 0.25})`);
      ray.addColorStop(0.7, "rgba(255,188,156,0.18)");
      ray.addColorStop(1, "rgba(255,188,156,0)");
      ctx.strokeStyle = ray;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * length, cy + Math.sin(a) * length);
      ctx.stroke();
    }
    ctx.strokeStyle = "#edbca0";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(cx, cy, 72 + p * 34, aim - spread, aim + spread);
    ctx.stroke();
  } else if (e.leviathanAttack === "breach" && e.leviathanDashTo) {
    const dx = e.leviathanDashTo.x - cx;
    const dy = e.leviathanDashTo.y - cy;
    const angle = Math.atan2(dy, dx);
    const across = Math.abs(Math.sin(angle)) * e.w + Math.abs(Math.cos(angle)) * e.h;
    const along = Math.abs(Math.cos(angle)) * e.w + Math.abs(Math.sin(angle)) * e.h;
    drawAimWarning(ctx, cx, cy, angle, Math.hypot(dx, dy), across, p, along / 2);
    drawTargetBrackets(ctx, e.leviathanDashTo.x, e.leviathanDashTo.y, e.w, e.h, "#f7c7a5");
  }
  ctx.restore();
}

/** Draw immediately after the background, so no warning obscures live bullets. */
function drawOceanOverlay(ctx, state, W, H) {
  ctx.save();
  const t = state.elapsed || 0;
  const cfg = state.tideCfg;
  const warn = state.tidePhase === "warn";
  const active = !!state.tideActive;
  if (cfg && (warn || active)) {
    const direction = state.tideDirection < 0 ? -1 : 1;
    const color = warn ? "#f5bf91" : "#79bdc1";
    const duration = warn ? (cfg.warnMs || 2400) : (cfg.activeMs || 8000);
    const elapsedInPhase = Math.max(0, state.tideTimerMs || 0);
    const remain = Math.max(0, duration - elapsedInPhase);
    const progress = 1 - Math.min(1, remain / duration);
    // 地面流线只铺左右边缘；玩家仍然能看清实际的横流方向。
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.globalAlpha = active ? 0.22 : 0.26 + progress * 0.15;
    for (let i = 0; i < 7; i += 1) {
      const y = H * 0.27 + i * H * 0.09;
      for (let side = 0; side < 2; side += 1) {
        const drift = active && state.flashEffectsOn !== false ? ((t * 0.026) % 20) * direction : 0;
        const x = side ? W - 21 + drift * 0.2 : 21 + drift * 0.2;
        drawArrow(ctx, x, y, direction, 8);
        drawArrow(ctx, x + direction * 11, y, direction, 8);
      }
    }
    ctx.globalAlpha = 1;
    const labelW = Math.min(W - 24, 238);
    const labelX = (W - labelW) / 2;
    const labelY = 178;
    ctx.fillStyle = "rgba(3,17,29,0.90)";
    ctx.fillRect(labelX, labelY, labelW, 31);
    ctx.fillStyle = warn ? "#ffe1bb" : "#c5e9e5";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const arrow = direction > 0 ? "→" : "←";
    const title = warn ? `涨潮将至 ${arrow}  ${Math.ceil(remain / 1000)}s` : `涨潮 ${arrow}  经验 +20%`;
    ctx.fillText(title, W / 2, labelY + 14);
    ctx.fillStyle = color;
    ctx.fillRect(labelX + 1, labelY + 29, (labelW - 2) * (1 - progress), 2);
  }

  const enemies = state.enemies || [];
  for (let i = 0; i < enemies.length; i += 1) {
    const e = enemies[i];
    if (!e) continue;
    if (e.bossVariant === "leviathan") {
      drawBossWarning(ctx, e, state, W, H);
      continue;
    }
    if (!OCEAN_TYPES[e.type] || e.type === "abyssalAngler" || e.oceanAttackPhase !== "warn") continue;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const p = clamp01(e.oceanWarnProgress);
    const aim = typeof e.oceanAimAngle === "number" ? e.oceanAimAngle : Math.PI / 2;
    if (e.type === "needlefish") {
      const across = Math.abs(Math.sin(aim)) * e.w + Math.abs(Math.cos(aim)) * e.h;
      const along = Math.abs(Math.cos(aim)) * e.w + Math.abs(Math.sin(aim)) * e.h;
      drawAimWarning(ctx, cx, cy, aim, 8.4 * 470 / 16.667, across, p, along / 2);
    } else {
      ctx.strokeStyle = e.type === "jellyfish" ? "#e8b2ca" : "#f6c092";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(e.w, e.h) * 0.73, -Math.PI / 2, -Math.PI / 2 + TAU * p);
      ctx.stroke();
      if (e.type === "inkCuttlefish") {
        const offsets = [-0.18, 0, 0.18];
        for (let j = 0; j < offsets.length; j += 1) {
          const a = aim + offsets[j];
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * e.h * 0.6, cy + Math.sin(a) * e.h * 0.6);
          ctx.lineTo(cx + Math.cos(a) * (e.h + 35), cy + Math.sin(a) * (e.h + 35));
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

/** Map card vignette: clipped, static and without combat indicators. */
function drawOceanSwatch(ctx, x, y, w, h, theme) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  drawOceanBackground(ctx, { theme: theme || {}, elapsed: 7600, flashEffectsOn: false }, w, h);
  ctx.globalAlpha *= 0.50;
  drawOceanEnemy(ctx, {
    type: "boss", bossVariant: "leviathan", leviathanPhase: 1,
    x: w * 0.60, y: -h * 0.07, w: w * 0.42, h: h * 1.12,
  }, { elapsed: 0, flashEffectsOn: false });
  ctx.restore();
}

module.exports = {
  drawOceanBackground,
  drawOceanEnemy,
  drawOceanOverlay,
  drawOceanSwatch,
};
