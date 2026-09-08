/** 潮汐使关闭贴图时的完整海洋战机。只画可视矩形，不影响护盾或碰撞。 */
const TAU = Math.PI * 2;
function oval(ctx, x, y, rx, ry, fill, stroke) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}
function drawTidecallerShape(ctx, x, y, w, h, state) {
  if (!(w > 0 && h > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const t = state && state.flashEffectsOn !== false ? (state.elapsed || 0) : 0;
  ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.scale(w / 100, h / 100);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // 蝠鲼形翼从珍珠核心向两侧舒展；翼膜和贝甲分层，而非基础三角形。
  for (let side = -1; side <= 1; side += 2) {
    const fin = Math.sin(t * 0.006 + side * 0.6) * 2;
    ctx.beginPath(); ctx.moveTo(side * 8, -25);
    ctx.bezierCurveTo(side * 26, -27, side * 42, -15 + fin, side * 48, 4 + fin);
    ctx.bezierCurveTo(side * 38, 0, side * 31, 15, side * 19, 23);
    ctx.quadraticCurveTo(side * 17, 10, side * 7, 9); ctx.closePath();
    ctx.fillStyle = "#5796bb"; ctx.fill(); ctx.strokeStyle = "#acdfe3"; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(side * 10, -14);
    ctx.quadraticCurveTo(side * 29, -14, side * 40, 1 + fin);
    ctx.quadraticCurveTo(side * 26, 1, side * 20, 15); ctx.closePath();
    ctx.fillStyle = "#a1cfd0"; ctx.fill();
    ctx.beginPath(); ctx.moveTo(side * 14, -12); ctx.quadraticCurveTo(side * 23, -1, side * 27, 8);
    ctx.strokeStyle = "#506f9a"; ctx.lineWidth = 1.8; ctx.stroke();
    oval(ctx, side * 13, 24, 6, 10, "#446d91", "#d2d5bd");
    oval(ctx, side * 13, 31, 3.5, 6, "#b2f2ed");
  }
  ctx.beginPath(); ctx.moveTo(0, -47);
  ctx.bezierCurveTo(-7, -35, -14, -11, -12, 13);
  ctx.quadraticCurveTo(-8, 34, 0, 41); ctx.quadraticCurveTo(8, 34, 12, 13);
  ctx.bezierCurveTo(14, -11, 7, -35, 0, -47); ctx.closePath();
  ctx.fillStyle = "#dce5d8"; ctx.fill(); ctx.strokeStyle = "#93c5ce"; ctx.lineWidth = 2.5; ctx.stroke();
  // 贝壳甲片与纵向珍珠座。
  for (let i = 0; i < 3; i += 1) {
    const yy = i * 10 - 27;
    ctx.beginPath(); ctx.moveTo(-7 - i, yy + 7); ctx.quadraticCurveTo(0, yy - 3, 7 + i, yy + 7);
    ctx.strokeStyle = "#79a4b6"; ctx.lineWidth = 2; ctx.stroke();
  }
  oval(ctx, 0, 5, 9, 13, "#385b83", "#e3dab6");
  oval(ctx, 0, 3, 6, 8, "#c9efed", "#83b9d0");
  oval(ctx, -1.5, 0, 2.6, 3.2, "#fff9e0");
  ctx.beginPath(); ctx.moveTo(0, 20); ctx.quadraticCurveTo(6, 37, Math.sin(t * 0.006) * 3, 48);
  ctx.strokeStyle = "#8bcace"; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore(); return true;
}
module.exports = { drawTidecallerShape };
