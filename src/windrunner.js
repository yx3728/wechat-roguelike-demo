/** 逐风者：真实位移蓄风，一次只储存一轮强化主炮。 */
const WIND_CHARGE_DISTANCE = 180;

function chargeWindrunner(state, fromX, fromY) {
  if (state.characterId !== "windrunner" || state.gameOver || state.pausedForUpgrade) return;
  const distance = Math.hypot(state.player.x - fromX, state.player.y - fromY);
  if (!Number.isFinite(distance)) return;
  state.windCharge = Math.min(WIND_CHARGE_DISTANCE, (state.windCharge || 0) + distance);
}

function consumeWindVolley(state) {
  if (state.characterId !== "windrunner" || (state.windCharge || 0) < WIND_CHARGE_DISTANCE) return false;
  state.windCharge = 0;
  state.windBurstMs = 260;
  return true;
}

function drawWindCharge(ctx, state, W, H) {
  if (state.characterId !== "windrunner") return;
  const ratio = Math.min(1, (state.windCharge || 0) / WIND_CHARGE_DISTANCE);
  const x = W / 2 - 70, y = H - 28;
  ctx.save();
  ctx.fillStyle = "rgba(10, 32, 28, 0.85)";
  ctx.fillRect(x - 8, y - 15, 156, 31);
  ctx.fillStyle = "#486857";
  ctx.fillRect(x, y + 7, 140, 3);
  ctx.fillStyle = ratio >= 1 ? "#f4d77b" : "#bce9cc";
  ctx.fillRect(x, y + 7, 140 * ratio, 3);
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ratio >= 1 ? "风矢就绪 · 下一轮穿透" : "移动蓄风  " + Math.floor(ratio * 100) + "%", W / 2, y - 4);
  ctx.restore();
}

module.exports = { WIND_CHARGE_DISTANCE, chargeWindrunner, consumeWindVolley, drawWindCharge };
