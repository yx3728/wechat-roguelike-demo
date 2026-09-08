/** 草原的无贴图外观：草浪、动物与植物解剖、鹿王关节动画、真实招式预警。 */
const TAU = Math.PI * 2;
const TYPES = Object.assign(Object.create(null), { meadowHare: true, bladeMantis: true, lanternBeetle: true, thornBloom: true, galeFalcon: true, thunderBison: true });
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, Number(n) || 0)); }
function paint(ctx, fill, edge, width) {
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = width || 2.4; ctx.stroke(); }
}
function oval(ctx, x, y, rx, ry, fill, edge, width) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); paint(ctx, fill, edge, width);
}
function leaf(ctx, x, y, tipX, tipY, width, fill, edge) {
  const dx = tipX - x, dy = tipY - y, len = Math.hypot(dx, dy) || 1;
  const px = -dy / len * width, py = dx / len * width;
  ctx.beginPath(); ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + dx * 0.25 + px, y + dy * 0.25 + py, tipX + px * 0.4, tipY + py * 0.4, tipX, tipY);
  ctx.bezierCurveTo(tipX - px * 0.4, tipY - py * 0.4, x + dx * 0.25 - px, y + dy * 0.25 - py, x, y);
  ctx.closePath(); paint(ctx, fill, edge, 2);
}
function limb(ctx, x, y, mx, my, ex, ey, color, width) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(mx, my, ex, ey);
  ctx.strokeStyle = "#202621"; ctx.lineWidth = width + 2; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function themeColor(state, key, fallback) {
  const from = state.themeFrom || state.theme || {}, to = state.themeTo || state.theme || {};
  const a = parseInt((from[key] || fallback).slice(1), 16), b = parseInt((to[key] || fallback).slice(1), 16);
  const p = state.themeBlendT == null ? 1 : clamp(state.themeBlendT, 0, 1);
  return `rgb(${Math.round(((a >> 16) & 255) * (1 - p) + ((b >> 16) & 255) * p)},${Math.round(((a >> 8) & 255) * (1 - p) + ((b >> 8) & 255) * p)},${Math.round((a & 255) * (1 - p) + (b & 255) * p)})`;
}

function drawGrasslandBackground(ctx, state, W, H) {
  const t = state.flashEffectsOn === false ? 0 : (state.elapsed || 0);
  ctx.save();
  const incomingAlpha = ctx.globalAlpha;
  ctx.fillStyle = themeColor(state, "bg", "#263b28"); ctx.fillRect(0, 0, W, H);
  // 零散草甸与裸土地构成地面；不使用海洋式整屏光带或平行水流。
  for (let i = 0; i < 16; i += 1) {
    const x = (i * 137 + 31) % W, y = (i * 173 + 20) % (H + 70) - 35;
    const rx = 29 + i % 4 * 14, ry = 18 + i % 3 * 11;
    ctx.globalAlpha = incomingAlpha * (i % 3 ? 0.16 : 0.21);
    ctx.fillStyle = i % 3 ? "#78864a" : "#79623f";
    ctx.beginPath(); ctx.moveTo(x - rx, y);
    ctx.bezierCurveTo(x - rx * 0.8, y - ry, x + rx * 0.2, y - ry * 0.7, x + rx, y - ry * 0.2);
    ctx.bezierCurveTo(x + rx * 1.2, y + ry * 0.5, x - rx * 0.2, y + ry, x - rx, y); ctx.fill();
  }
  // 断续蹄印呈弯曲兽径，细节暗于互动草丛，中央仍能读清子弹。
  ctx.globalAlpha = incomingAlpha * 0.18;
  for (let i = 0; i < 24; i += 1) {
    const y = i * 43 - 20, x = W * (0.48 + Math.sin(i * 0.38) * 0.14);
    const turn = Math.cos(i * 0.38) * 0.5;
    ctx.save(); ctx.translate(x, y); ctx.rotate(turn);
    oval(ctx, -4, 0, 2.3, 4, "#afa078"); oval(ctx, 4, 5, 2.3, 4, "#afa078"); ctx.restore();
  }
  for (let i = 0; i < 47; i += 1) {
    const edge = i % 3 !== 0;
    const x = edge ? (i % 2 ? W - 7 - (i * 17 % 58) : 7 + (i * 17 % 58)) : (i * 79 % W);
    const y = (i * 89 + 21) % (H + 40) - 20;
    const sway = Math.sin(t * 0.0017 + i * 1.2) * 2;
    ctx.globalAlpha = incomingAlpha * (edge ? 0.30 : 0.12);
    ctx.strokeStyle = i % 3 ? "#91a45c" : "#bbac72"; ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let blade = -1; blade <= 1; blade += 1) {
      ctx.moveTo(x + blade * 2, y + 8);
      ctx.quadraticCurveTo(x + blade * 4, y - 1, x + blade * 6 + sway, y - 9 - (i % 3) * 3);
    }
    ctx.stroke();
    if (i % 7 === 0) {
      oval(ctx, x + sway, y - 9, 2.5, 3, "#c4b889");
      oval(ctx, x - 3 + sway, y - 8, 2.5, 2, "#b49181");
    }
  }
  for (let i = 0; i < 7; i += 1) {
    const x = i % 2 ? W - 12 - i % 3 * 7 : 12 + i % 3 * 7, y = (i * 157 + 43) % H;
    ctx.globalAlpha = incomingAlpha * 0.4;
    ctx.beginPath(); ctx.moveTo(x - 12, y + 7); ctx.lineTo(x - 9, y - 5);
    ctx.lineTo(x + 2, y - 10); ctx.lineTo(x + 13, y - 1); ctx.lineTo(x + 9, y + 10); ctx.closePath();
    paint(ctx, "#37413a", "#73765b", 1);
    ctx.strokeStyle = "#8f926b"; ctx.beginPath(); ctx.moveTo(x - 9, y - 5); ctx.lineTo(x + 3, y + 2); ctx.stroke();
  }
  ctx.globalAlpha = incomingAlpha * 0.18;
  for (let i = 0; i < 9; i += 1) {
    const x = (i * 107 + t * 0.005 + W) % W, y = (i * 97 + Math.sin(t * 0.001 + i) * 5 + H) % H;
    ctx.save(); ctx.translate(x, y); ctx.rotate(i + t * 0.0005);
    oval(ctx, 0, 0, 1.5, 3, "#c8b775"); ctx.restore();
  }
  ctx.restore();
}

function drawHare(ctx, e, t) {
  const hop = Math.sin(t * 0.01 + e.x) * (e.grassAttackPhase === "dodge" ? 7 : 3);
  oval(ctx, -23, 9 + hop, 12, 22, "#857f5b", "#d7c99c");
  oval(ctx, 23, 9 - hop, 12, 22, "#857f5b", "#d7c99c");
  oval(ctx, 0, -1, 22, 27, "#ac9f72", "#e6d7ae");
  oval(ctx, 0, -28, 8, 9, "#e0d6b4");
  for (let side = -1; side <= 1; side += 2) {
    leaf(ctx, side * 10, 11, side * (18 + Math.sin(t * 0.004) * 2), -47, 8, "#c7bd90", "#ead9b0");
    leaf(ctx, side * 11, 1, side * 17, -36, 3.6, "#926852");
    oval(ctx, side * 13, 36 + hop * side * 0.4, 7, 10, "#d7c99c", "#806e4d", 1.8);
  }
  oval(ctx, 0, 22, 18, 17, "#c7b98c", "#ead9b0");
  oval(ctx, -11, 23, 4, 4.8, "#efb16f", "#534332", 1.8);
  oval(ctx, 11, 23, 4, 4.8, "#efb16f", "#534332", 1.8);
  oval(ctx, 0, 33, 5, 3.5, "#715247");
  ctx.strokeStyle = "#eee0b7"; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(-4, 32); ctx.lineTo(-25, 29); ctx.moveTo(4, 32); ctx.lineTo(25, 29); ctx.stroke();
}

function drawMantis(ctx, e, t) {
  const ready = e.grassAttackPhase === "warn" ? clamp(e.grassWarnProgress, 0, 1) : 0;
  const airborne = e.grassAttackPhase === "leap" ? Math.sin(clamp(e.grassLeapProgress, 0, 1) * Math.PI) : 0;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 2; i += 1) limb(ctx, side * 11, -21 + i * 20,
      side * 29, -10 + i * 24, side * 36, 8 + i * 22, "#a0ae69", 3);
    const reach = 8 * ready - airborne * 13 + Math.sin(t * 0.006 + side) * 1.5;
    limb(ctx, side * 12, 13, side * 32, 7 - reach, side * 35, 22 - reach, "#afbf77", 5);
    ctx.beginPath(); ctx.moveTo(side * 31, 15 - reach);
    ctx.bezierCurveTo(side * 52, 19, side * 48, 40, side * 25, 48);
    ctx.quadraticCurveTo(side * 37, 32, side * 31, 15 - reach); ctx.closePath();
    paint(ctx, "#d4d7a3", "#78894f", 2.5);
  }
  leaf(ctx, 0, 16, 0, -48, 19, "#567642", "#bbca82");
  ctx.strokeStyle = "#a4b86a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(0, 10); ctx.stroke();
  oval(ctx, 0, 17, 16, 11, "#93a366", "#d4d7a3");
  oval(ctx, -12, 17, 4.7, 5, "#e9b776"); oval(ctx, 12, 17, 4.7, 5, "#e9b776");
  ctx.strokeStyle = "#d6cf9d"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-7, 23); ctx.quadraticCurveTo(-16, 35, -23, 37);
  ctx.moveTo(7, 23); ctx.quadraticCurveTo(16, 35, 23, 37); ctx.stroke();
}

function drawBeetle(ctx, e, t) {
  const pulse = 1 + Math.sin(t * 0.007) * 0.035;
  const pushing = e.grassAttackPhase === "push";
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 3; i += 1) limb(ctx, side * 20, -17 + i * 16,
      side * 35, -10 + i * 14, side * 43, -17 + i * 23 + (pushing ? Math.sin(t * 0.018 + i) * 5 : 0), "#bbaa65", 4);
  }
  oval(ctx, 0, -3, 29, 35, "#2d4940", "#c5bc75", 3);
  oval(ctx, 0, -3, 12 * pulse, 25, e.grassShellOpen ? "#ffd888" : "#99ab50", "#d2c781", 1.5);
  for (let side = -1; side <= 1; side += 2) {
    const split = e.grassShellOpen ? 10 : 1;
    ctx.beginPath(); ctx.moveTo(side * split, -35);
    ctx.bezierCurveTo(side * (34 + split * 0.2), -32, side * 35, 19, side * 9, 29);
    ctx.lineTo(side * split, -35); ctx.closePath(); paint(ctx, "#4e7150", "#c1bd7a", 2.3);
    ctx.strokeStyle = "#7fa278"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(side * 13, -24); ctx.quadraticCurveTo(side * 25, -11, side * 19, 12); ctx.stroke();
  }
  oval(ctx, 0, 31, 14, 12, "#445447", "#cbbd78", 2.5);
  oval(ctx, -8, 35, 4, 3.8, "#ffca76"); oval(ctx, 8, 35, 4, 3.8, "#ffca76");
  limb(ctx, -8, 38, -17, 49, -25, 44, "#d9c588", 2);
  limb(ctx, 8, 38, 17, 49, 25, 44, "#d9c588", 2);
}

function drawBloom(ctx, e, t) {
  const breathe = Math.sin(t * 0.004) * 2 - (e.grassAttackPhase === "grow" ? 5 : 0);
  ctx.strokeStyle = "#5e753d"; ctx.lineWidth = 3;
  for (let i = 0; i < 4; i += 1) {
    const a = i * TAU / 4 + 0.35;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(Math.cos(a + 0.3) * 29, Math.sin(a + 0.3) * 29, Math.cos(a) * 49, Math.sin(a) * 49); ctx.stroke();
  }
  for (let i = 0; i < 5; i += 1) {
    const a = i * TAU / 5 + 0.2;
    leaf(ctx, 0, 4, Math.cos(a) * 47, Math.sin(a) * 47, 12, "#445e3f", "#859969");
  }
  for (let i = 0; i < 6; i += 1) {
    const a = i * TAU / 6 - Math.PI / 2;
    leaf(ctx, 0, 0, Math.cos(a) * (35 + breathe), Math.sin(a) * (35 + breathe), 17, "#ae605e", "#e3ac84");
  }
  oval(ctx, 0, 0, 17, 17, "#633d39", "#dda26d", 3);
  oval(ctx, 0, 0, 9, 9, "#e6b364", "#f2d194", 2);
  for (let i = 0; i < 6; i += 1) oval(ctx, Math.cos(i * TAU / 6) * 12, Math.sin(i * TAU / 6) * 12, 2, 2, "#f4d89a");
}

function drawFalcon(ctx, e, t) {
  const flap = e.grassAttackPhase === "swoop" ? 11 : Math.sin(t * 0.009 + e.x * 0.08) * 7;
  for (let side = -1; side <= 1; side += 2) {
    ctx.beginPath(); ctx.moveTo(side * 7, -13);
    ctx.bezierCurveTo(side * 24, -30, side * 40, -25, side * 49, -35 + flap);
    ctx.lineTo(side * 44, -9 + flap); ctx.lineTo(side * 35, -14 + flap);
    ctx.lineTo(side * 32, 9); ctx.lineTo(side * 25, 1); ctx.lineTo(side * 15, 27); ctx.lineTo(side * 6, 17);
    ctx.closePath(); paint(ctx, "#9a685b", "#e1c198", 2.5);
    ctx.strokeStyle = "#c19a78"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(side * 15, -10); ctx.lineTo(side * 38, -16 + flap);
    ctx.moveTo(side * 13, 1); ctx.lineTo(side * 27, -5); ctx.stroke();
  }
  leaf(ctx, 0, 5, -10, -48, 7, "#a88066", "#e3caa1");
  leaf(ctx, 0, 5, 10, -48, 7, "#a88066", "#e3caa1");
  oval(ctx, 0, -1, 12, 27, "#bfb290", "#e9d8ad", 2.5);
  oval(ctx, 0, 24, 12, 12, "#e5d4a9", "#936c4b", 2);
  oval(ctx, -7, 25, 3, 3, "#5b332b"); oval(ctx, 7, 25, 3, 3, "#5b332b");
  leaf(ctx, 0, 30, 0, 46, 6, "#d49b51", "#634b33");
}

function drawBison(ctx, e, t) {
  const step = Math.sin(t * 0.006) * (e.grassAttackPhase === "guard" ? 1.4 : 5);
  for (let side = -1; side <= 1; side += 2) {
    oval(ctx, side * 25, -13 + step * side, 9, 16, "#48545b", "#b4ab8b", 2);
    oval(ctx, side * 25, 29 - step * side, 10, 14, "#35454d", "#b4ab8b", 2);
    oval(ctx, side * 25, 40 - step * side, 8, 5, "#252b2c", "#c9bc91", 1.5);
  }
  oval(ctx, 0, -9, 31, 33, "#42565d", "#acaa89", 3);
  for (let i = 0; i < 4; i += 1) {
    ctx.strokeStyle = "#73867e"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-22, -25 + i * 10); ctx.quadraticCurveTo(0, -13 + i * 10, 22, -25 + i * 10); ctx.stroke();
  }
  oval(ctx, 0, 19, 26, 23, "#5b5a51", "#d2c393", 3);
  for (let side = -1; side <= 1; side += 2) {
    ctx.beginPath(); ctx.moveTo(side * 18, 15);
    ctx.bezierCurveTo(side * 47, 16, side * 49, -10, side * 36, -22);
    ctx.quadraticCurveTo(side * 39, 2, side * 16, 4); ctx.closePath(); paint(ctx, "#e5d6a9", "#8b7d54", 2.5);
    oval(ctx, side * 15, 23, 4, 3.5, "#f3ba76");
  }
  oval(ctx, 0, 34, 15, 9, "#2f3738", "#aa9d79", 2);
  oval(ctx, -6, 35, 2.5, 2, "#c6b387"); oval(ctx, 6, 35, 2.5, 2, "#c6b387");
  ctx.strokeStyle = "#e2c17b"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-4, -24); ctx.lineTo(3, -14); ctx.lineTo(-3, -6); ctx.lineTo(4, 4); ctx.stroke();
}

function antler(ctx, side, phase, angle) {
  ctx.save(); ctx.translate(side * 10, 9); ctx.rotate(side * angle); ctx.translate(-side * 10, -9);
  ctx.strokeStyle = phase === 2 ? "#e6c273" : "#d7d1ad";
  ctx.lineWidth = phase === 2 ? 4.2 : 3.5;
  ctx.beginPath(); ctx.moveTo(side * 10, 11);
  ctx.bezierCurveTo(side * 24, 0, side * 40, -19, side * 36, -44);
  ctx.moveTo(side * 22, -3); ctx.lineTo(side * 39, 0); ctx.lineTo(side * 48, -8);
  ctx.moveTo(side * 30, -16); ctx.lineTo(side * 49, -25);
  ctx.moveTo(side * 34, -28); ctx.lineTo(side * 24, -39); ctx.lineTo(side * 27, -49);
  ctx.stroke();
  if (phase === 2) {
    ctx.strokeStyle = "#f9d894"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(side * 39, -22); ctx.lineTo(side * 43, -36); ctx.lineTo(side * 48, -39); ctx.stroke();
  }
  ctx.restore();
}

function drawAntlerKing(ctx, e, t) {
  const phase = e.grassPhase === 2 ? 2 : 1;
  const gait = t ? t * (e.grassState === "plow" ? 0.012 : e.grassState === "guard" ? 0.002 : 0.005) : 0;
  const windup = e.grassState === "warn" ? clamp(e.grassWarnProgress, 0, 1) : 0;
  const coat = phase === 2 ? "#785d38" : "#365b58";
  const trim = phase === 2 ? "#f0d491" : "#d9d7b1";
  ctx.save(); ctx.scale(0.92, 0.94);
  for (let side = -1; side <= 1; side += 2) {
    for (let leg = 0; leg < 2; leg += 1) {
      const rootY = leg ? 10 : -22;
      const swing = t ? Math.sin(gait + (side > 0 ? Math.PI : 0) + leg * Math.PI) * (e.grassState === "plow" ? 10 : 5 + windup * 2) : 0;
      limb(ctx, side * 16, rootY, side * (28 + swing * 0.35), rootY + 9,
        side * (26 - swing * 0.25), rootY + 23 + swing, phase === 2 ? "#9a977b" : "#7c9b83", 6);
      oval(ctx, side * (26 - swing * 0.25), rootY + 25 + swing, 5.8, 4.2, "#273332", trim, 1.5);
    }
  }
  leaf(ctx, 0, -13, t ? Math.sin(gait - 0.8) * 5 : 0, -48, 7, "#b5c0a0", trim);
  oval(ctx, 0, -9, 23, 34, coat, trim, 2.3);
  for (let i = 0; i < 4; i += 1) {
    const spread = t ? Math.sin(gait - i * 0.6) : 0;
    ctx.strokeStyle = phase === 2 ? "#b3b089" : "#8eac92"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-16 - spread, -29 + i * 10);
    ctx.quadraticCurveTo(0, -19 + i * 10, 16 + spread, -29 + i * 10); ctx.stroke();
  }
  for (let side = -1; side <= 1; side += 2) {
    leaf(ctx, side * 9, 15, side * 29, 5, 8, "#afbe9a", trim);
    antler(ctx, side, phase, (t ? Math.sin(gait * 0.65 + side) * 0.035 : 0) - windup * 0.07);
  }
  oval(ctx, 0, 22, 13, 18, phase === 2 ? "#ded3a9" : "#bfcaac", trim, 2);
  leaf(ctx, 0, 7, 0, 30, 6, phase === 2 ? "#dbb46f" : "#608d78", trim);
  oval(ctx, -8, 24, 3.4, 2.6, phase === 2 ? "#f6a764" : "#f3cc8b");
  oval(ctx, 8, 24, 3.4, 2.6, phase === 2 ? "#f6a764" : "#f3cc8b");
  oval(ctx, 0, 37, 8, 5.5, "#364642", trim, 1.4);
  if (phase === 2) {
    ctx.strokeStyle = "#f0bb73"; ctx.lineWidth = 2.3;
    ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(-3, -19); ctx.lineTo(3, -9); ctx.lineTo(-2, 2); ctx.stroke();
  }
  ctx.restore();
}

/** 同一动作姿态用于贴图与无贴图，不改变碰撞中心。 */
function getGrasslandPose(e, state) {
  const moving = state.flashEffectsOn !== false, t = moving ? (state.elapsed || 0) : 0;
  const pose = { angle: 0, x: 0, y: 0, sx: 1, sy: 1, alpha: 1 };
  const action = e.grassAttackPhase;
  if (e.type === "bladeMantis") {
    if (action === "hide") { pose.alpha = 0.48; pose.sx = 0.9; pose.sy = 0.87; }
    if (action === "warn") { pose.sx = 1.07; pose.sy = 0.89; }
    if (action === "leap") {
      const lift = Math.sin(clamp(e.grassLeapProgress, 0, 1) * Math.PI);
      pose.y = -lift * e.h * 0.12; pose.sx = 1 + lift * 0.08; pose.sy = 1 + lift * 0.05;
    }
    if ((action === "warn" || action === "leap") && Number.isFinite(e.grassAimAngle)) pose.angle = e.grassAimAngle - Math.PI / 2;
  } else if (e.type === "meadowHare") {
    if (action === "dodge") { pose.angle = clamp(e.grassDodgeDir, -1, 1) * -0.28; pose.sx = 0.92; pose.sy = 1.06; }
    pose.y = moving ? -Math.max(0, Math.sin(t * (action === "flee" ? 0.018 : 0.011))) * e.h * 0.04 : 0;
  } else if (e.type === "galeFalcon") {
    if (action === "orbit" && Number.isFinite(e.grassOrbitAngle)) pose.angle = e.grassOrbitAngle;
    else if (Number.isFinite(e.grassAimAngle) && (action === "swoop" || action === "exit")) pose.angle = e.grassAimAngle - Math.PI / 2;
    pose.sx = action === "swoop" ? 0.76 : 1 + Math.sin(t * 0.014) * 0.045;
    pose.sy = action === "swoop" ? 1.1 : 1;
  } else if (e.type === "lanternBeetle") {
    if (Number.isFinite(e.grassAimAngle) && (action === "warn" || action === "push")) pose.angle = e.grassAimAngle - Math.PI / 2;
    pose.sy = action === "push" ? 0.93 : 1;
    pose.y = moving && action === "push" ? Math.sin(t * 0.018) * e.h * 0.02 : 0;
  } else if (e.type === "thornBloom") {
    pose.sx = pose.sy = action === "grow" ? 0.88 + (moving ? Math.sin(t * 0.008) * 0.025 : 0) : 1;
  } else if (e.type === "thunderBison") {
    if (Number.isFinite(e.grassGuardAngle)) pose.angle = e.grassGuardAngle - Math.PI / 2;
    if (action === "guard") { pose.sx = 1.06; pose.sy = 0.94; }
    else if (action === "tired") { pose.angle += 0.12; pose.sy = 0.94; }
  } else if (e.bossVariant === "antlerKing") {
    if (Number.isFinite(e.grassAimAngle) && (e.grassState === "warn" || e.grassState === "plow")) pose.angle = e.grassAimAngle - Math.PI / 2;
    else pose.angle = moving ? Math.sin(t * 0.0025) * 0.025 : 0;
    if (e.grassState === "guard") { pose.sx = 1.025; pose.sy = 0.98; }
    if (e.grassState === "stagger") { pose.angle += 0.10; pose.sy = 0.94; }
    if (e.grassState === "warn") pose.sy = 1 - clamp(e.grassWarnProgress, 0, 1) * 0.05;
  }
  return pose;
}

function drawGrasslandEnemy(ctx, e, state) {
  if (!e || (!TYPES[e.type] && e.bossVariant !== "antlerKing") || !(e.w > 0 && e.h > 0)
    || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return false;
  const s = state || {}, t = s.flashEffectsOn === false ? 0 : (s.elapsed || 0);
  const pose = getGrasslandPose(e, s);
  ctx.save(); ctx.translate(e.x + e.w / 2 + pose.x, e.y + e.h / 2 + pose.y); ctx.rotate(pose.angle);
  ctx.scale(e.w / 100 * pose.sx, e.h / 100 * pose.sy); ctx.globalAlpha *= pose.alpha;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (e.bossVariant === "antlerKing") drawAntlerKing(ctx, e, t);
  else if (e.type === "meadowHare") drawHare(ctx, e, t);
  else if (e.type === "bladeMantis") drawMantis(ctx, e, t);
  else if (e.type === "lanternBeetle") drawBeetle(ctx, e, t);
  else if (e.type === "thornBloom") drawBloom(ctx, e, t);
  else if (e.type === "galeFalcon") drawFalcon(ctx, e, t);
  else drawBison(ctx, e, t);
  ctx.restore(); drawGrasslandAdornment(ctx, e, s); return true;
}

function drawWindrunnerShape(ctx, x, y, w, h, state) {
  if (!(w > 0 && h > 0)) return false;
  const t = state && state.flashEffectsOn !== false ? (state.elapsed || 0) : 0;
  ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.scale(w / 100, h / 100);
  ctx.lineJoin = "round";
  for (let side = -1; side <= 1; side += 2) {
    const tilt = Math.sin(t * 0.007 + side) * 1.8;
    leaf(ctx, side * 5, 21, side * 45, 7 + tilt, 14, "#e5e3c9", "#bba568");
    leaf(ctx, side * 7, -2, side * 32, -33 + tilt, 11, "#5db2a5", "#ded7a7");
    oval(ctx, side * 15, 24, 7, 15, "#477d76", "#d2c38d", 2.5);
    oval(ctx, side * 15, 35, 4, 5, "#a5e9e2");
    ctx.strokeStyle = "#8ba99a"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(side * 10, 15); ctx.lineTo(side * 35, 8 + tilt); ctx.stroke();
  }
  leaf(ctx, 0, 39, 0, -49, 13, "#7ac7b9", "#eee6bf");
  oval(ctx, 0, -12, 6, 15, "#23494d", "#c9dcc7", 2);
  ctx.strokeStyle = "#d9bd76"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -39); ctx.lineTo(0, -29); ctx.moveTo(0, 6); ctx.lineTo(0, 30); ctx.stroke();
  ctx.restore(); return true;
}

function validPoint(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.y); }
function drawCover(ctx, cover, t) {
  if (!validPoint(cover) || !(cover.r > 0)) return;
  const intact = cover.active !== false && cover.hp > 0;
  const health = clamp(cover.hp / (cover.maxHp || 8), 0, 1);
  const regrow = intact ? 1 : 1 - clamp((cover.regrowMs || 0) / 14000, 0, 1);
  const r = cover.r;
  ctx.save(); ctx.translate(cover.x, cover.y);
  ctx.globalAlpha *= intact ? 0.86 : 0.38;
  oval(ctx, 0, r * 0.22, r, r * 0.60, intact ? "#203a23" : "#473d28");
  const leaves = intact ? 3 + Math.ceil(health * 10) : 3;
  for (let i = 0; i < leaves; i += 1) {
    const a = i * 2.39996, spread = 0.35 + (i % 3) * 0.22;
    const xx = Math.cos(a) * r * spread, yy = Math.sin(a) * r * 0.39;
    const tall = r * (intact ? 0.7 + (i % 4) * 0.12 : 0.12 + regrow * 0.25);
    const sway = Math.sin(t * 0.002 + i + cover.x) * 2;
    leaf(ctx, xx * 0.4, yy + r * 0.25, xx + sway, yy - tall * 0.65, r * 0.105,
      intact ? (i % 3 ? "#526f37" : "#76924c") : "#7a7450", intact ? "#94ad62" : "#96875b");
  }
  if (intact) {
    ctx.strokeStyle = "#bdc887"; ctx.lineWidth = 1;
    for (let i = 0; i < Math.ceil(health * 3); i += 1) {
      ctx.beginPath(); ctx.moveTo((i - 1) * r * 0.27, r * 0.3);
      ctx.quadraticCurveTo((i - 1) * r * 0.3, -r * 0.15, (i - 1) * r * 0.22, -r * 0.6); ctx.stroke();
    }
  }
  ctx.restore();
}
function drawRootBud(ctx, bud, t) {
  if (!validPoint(bud) || bud.hp <= 0 || bud.lifeMs <= 0) return;
  const growth = 1 - clamp((bud.growMs || 0) / 650, 0, 1), r = bud.r || 12;
  ctx.save(); ctx.translate(bud.x, bud.y); ctx.scale(0.45 + growth * 0.55, 0.45 + growth * 0.55);
  ctx.globalAlpha *= bud.active ? 1 : 0.68;
  oval(ctx, 0, 4, r, r * 0.56, "#302d21");
  for (let i = 0; i < 3; i += 1) {
    const a = i * TAU / 3;
    leaf(ctx, 0, 3, Math.cos(a) * r * 1.15, Math.sin(a) * r, r * 0.24, "#4c693a", "#92a866");
  }
  const segments = Math.max(1, Math.ceil(clamp(bud.hp / (bud.maxHp || 3), 0, 1) * 3));
  for (let i = 0; i < segments; i += 1) {
    const x = (i - (segments - 1) / 2) * r * 0.38;
    leaf(ctx, x, r * 0.4, x + Math.sin(t * 0.002 + i) * 0.8, -r * (0.55 + (i % 2) * 0.25), r * 0.26, "#b27951", "#e3b37e");
  }
  ctx.restore();
}
function drawVine(ctx, vine) {
  if (!vine || !validPoint(vine.a) || !validPoint(vine.b) || vine.lifeMs <= 0) return;
  const growth = 1 - clamp((vine.growMs || 0) / 650, 0, 1);
  const dx = vine.b.x - vine.a.x, dy = vine.b.y - vine.a.y, length = Math.hypot(dx, dy);
  if (length < 1) return;
  ctx.save(); ctx.translate(vine.a.x, vine.a.y); ctx.rotate(Math.atan2(dy, dx));
  ctx.globalAlpha *= vine.active ? 0.87 : 0.45;
  ctx.strokeStyle = vine.active ? "#62804a" : "#c0ac73"; ctx.lineWidth = vine.active ? 3.2 : 1.1;
  if (!vine.active) ctx.setLineDash([3, 6]);
  ctx.beginPath(); ctx.moveTo(0, 0);
  const visible = length * (vine.active ? 1 : 0.2 + growth * 0.8);
  for (let x = 5; x <= visible; x += 5) ctx.lineTo(x, Math.sin(x * 0.10) * 1.6);
  ctx.lineTo(visible, 0); ctx.stroke(); ctx.setLineDash([]);
  for (let x = 12; x < visible - 4; x += 23) {
    const side = Math.floor(x / 23) % 2 ? 1 : -1;
    leaf(ctx, x, 0, x + 6, side * 6, 2.2, "#75894b", "#bdba76");
  }
  ctx.restore();
}
function drawGrassBall(ctx, ball, t) {
  if (!validPoint(ball) || ball.dead || ball.hp === 0) return;
  const r = ball.r || 15;
  ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate(Number.isFinite(ball.spin) ? ball.spin : t * 0.008);
  oval(ctx, 0, 0, r, r, "#6c6133", "#c4b174", 1.7);
  for (let i = 0; i < 5; i += 1) {
    const a = i * TAU / 5;
    leaf(ctx, Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, Math.cos(a + 2.2) * r * 0.82,
      Math.sin(a + 2.2) * r * 0.82, r * 0.17, i % 2 ? "#819052" : "#ab975c", "#d6bd7e");
  }
  ctx.restore();
}
function drawGrasslandTerrain(ctx, state, W, H) {
  const t = state.flashEffectsOn === false ? 0 : (state.elapsed || 0);
  ctx.save();
  for (const vine of state.grassVines || []) drawVine(ctx, vine);
  for (const cover of state.grassCover || []) drawCover(ctx, cover, t);
  for (const bud of state.grassRootBuds || []) drawRootBud(ctx, bud, t);
  for (const ball of state.grassBalls || []) drawGrassBall(ctx, ball, t);
  ctx.restore();
}

function hoofMark(ctx, x, y, angle, width, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  oval(ctx, -width * 0.13, 0, width * 0.052, width * 0.10, color);
  oval(ctx, width * 0.13, 3, width * 0.052, width * 0.10, color); ctx.restore();
}
function plowRoute(ctx, e) {
  const points = e.grassPlowPoints || [];
  if (points.length < 3 || !points.every(validPoint)) return;
  const p = clamp(e.grassWarnProgress, 0, 1), [start, bend, end] = points;
  ctx.save(); ctx.globalAlpha *= 0.28 + p * 0.4;
  ctx.strokeStyle = "#d2b67c"; ctx.lineWidth = 1.2; ctx.setLineDash([4, 8]);
  ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.quadraticCurveTo(bend.x, bend.y, end.x, end.y); ctx.stroke(); ctx.setLineDash([]);
  for (let i = 1; i <= 8; i += 1) {
    const k = i / 8, v = 1 - k;
    const x = v * v * start.x + 2 * v * k * bend.x + k * k * end.x;
    const y = v * v * start.y + 2 * v * k * bend.y + k * k * end.y;
    const dx = 2 * v * (bend.x - start.x) + 2 * k * (end.x - bend.x);
    const dy = 2 * v * (bend.y - start.y) + 2 * k * (end.y - bend.y);
    hoofMark(ctx, x, y, Math.atan2(dy, dx) - Math.PI / 2, Math.min(e.w * 0.75, 76), "#dab780");
  }
  ctx.restore();
}

function drawGrasslandAdornment(ctx, e, state) {
  const guarding = e.type === "thunderBison" && e.grassAttackPhase === "guard";
  const herd = e.bossVariant === "antlerKing" && e.grassState === "guard";
  const exposed = e.bossVariant === "antlerKing" && e.grassState === "stagger";
  if (!guarding && !herd && !exposed) return;
  ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
  const a = guarding && Number.isFinite(e.grassGuardAngle) ? e.grassGuardAngle : Math.PI / 2;
  ctx.rotate(a - Math.PI / 2); ctx.lineJoin = "round";
  const width = Math.min(e.w, e.h);
  if (guarding || herd) {
    const count = herd ? 5 : 3;
    for (let i = 0; i < count; i += 1) {
      const k = i - (count - 1) / 2, x = k * width * 0.2;
      leaf(ctx, x, width * 0.48, x * 1.25, width * (0.64 - Math.abs(k) * 0.04), width * 0.10, "#6e8350", "#e0d79e");
    }
  } else {
    ctx.strokeStyle = "#efc388"; ctx.lineWidth = 1.4;
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath(); ctx.moveTo(i * width * 0.15, -width * 0.1);
      ctx.lineTo((i + 0.08) * width * 0.15, width * 0.03); ctx.lineTo(i * width * 0.15, width * 0.14); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawGrasslandOverlay(ctx, state, W, H) {
  drawGrasslandTerrain(ctx, state, W, H);
  ctx.save();
  for (const e of state.enemies || []) {
    if (!e || !TYPES[e.type] && e.bossVariant !== "antlerKing") continue;
    const x = e.x + e.w / 2, y = e.y + e.h / 2;
    if (e.bossVariant === "antlerKing") {
      if (e.grassAttack === "antlerPlow" && e.grassState === "warn") plowRoute(ctx, e);
      if (e.grassState === "guard") {
        for (const ally of e.grassHerdRefs || []) {
          if (!ally || ally.hp <= 0) continue;
          const ax = ally.x + ally.w / 2, ay = ally.y + ally.h / 2;
          ctx.save(); ctx.globalAlpha *= 0.22; ctx.strokeStyle = "#bdd397"; ctx.lineWidth = 1;
          ctx.setLineDash([2, 9]); ctx.beginPath(); ctx.moveTo(x, y);
          ctx.quadraticCurveTo((x + ax) / 2 + 9, (y + ay) / 2, ax, ay); ctx.stroke(); ctx.restore();
        }
      }
    } else if (e.type === "bladeMantis" && (e.grassAttackPhase === "warn" || e.grassAttackPhase === "leap") && validPoint(e.grassLanding)) {
      const landing = e.grassLanding, p = clamp(e.grassWarnProgress, 0, 1);
      ctx.save(); ctx.globalAlpha *= e.grassAttackPhase === "leap" ? 0.3 : 0.45 + p * 0.2;
      ctx.strokeStyle = "#d2bd80"; ctx.lineWidth = 1.3;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(landing.x + side * e.w * 0.5, landing.y - e.h * 0.2);
        ctx.quadraticCurveTo(landing.x + side * e.w * 0.8, landing.y + e.h * 0.2, landing.x + side * e.w * 0.25, landing.y + e.h * 0.5); ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawGrasslandSwatch(ctx, x, y, w, h, theme) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(x, y);
  drawGrasslandBackground(ctx, { theme: theme || {}, elapsed: 0, flashEffectsOn: false }, w, h);
  ctx.globalAlpha *= 0.55;
  drawGrasslandEnemy(ctx, { type: "boss", bossVariant: "antlerKing", grassPhase: 1,
    x: w * 0.67, y: -h * 0.06, w: w * 0.32, h: h * 1.05 }, { elapsed: 0, flashEffectsOn: false });
  ctx.restore();
}

module.exports = { drawGrasslandBackground, drawGrasslandEnemy, drawGrasslandOverlay, drawGrasslandTerrain,
  drawGrasslandSwatch, drawWindrunnerShape, getGrasslandPose, drawGrasslandAdornment };
