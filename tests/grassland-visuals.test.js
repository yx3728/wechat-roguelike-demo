"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const visuals = require("../src/grasslandVisuals.js");
const { drawTidecallerShape } = require("../src/tidecallerVisuals.js");

function canvas() {
  const calls = [], stack = [];
  const ctx = { globalAlpha: 0.4, fillStyle: "#123456", strokeStyle: "#234567", lineWidth: 1,
    font: "12px sans-serif", textAlign: "left", textBaseline: "alphabetic", lineCap: "butt", lineJoin: "miter",
    imageSmoothingEnabled: false };
  let transform = [1, 0, 0, 1, 0, 0], dash = [3, 7];
  const keys = Object.keys(ctx);
  function snapshot() { return { styles: Object.fromEntries(keys.map((key) => [key, ctx[key]])), transform: transform.slice(), dash: dash.slice() }; }
  function record(name, args) {
    for (const arg of args) if (typeof arg === "number") assert.ok(Number.isFinite(arg), `${name} must use finite coordinates`);
    assert.ok(transform.every(Number.isFinite));
    assert.ok(ctx.globalAlpha >= 0 && ctx.globalAlpha <= 1);
    if (name === "arc") assert.ok(args[2] >= 0);
    if (name === "ellipse") assert.ok(args[2] >= 0 && args[3] >= 0);
    calls.push({ name, args: Array.from(args) });
  }
  ctx.save = () => { stack.push(snapshot()); record("save", []); };
  ctx.restore = () => {
    assert.ok(stack.length, "restore must match save"); const saved = stack.pop();
    Object.assign(ctx, saved.styles); transform = saved.transform; dash = saved.dash; record("restore", []);
  };
  ctx.translate = (x, y) => { record("translate", [x, y]); transform[4] += transform[0] * x + transform[2] * y; transform[5] += transform[1] * x + transform[3] * y; };
  ctx.scale = (x, y) => { record("scale", [x, y]); transform[0] *= x; transform[1] *= x; transform[2] *= y; transform[3] *= y; };
  ctx.rotate = (angle) => {
    record("rotate", [angle]); const [a, b, c, d] = transform, co = Math.cos(angle), si = Math.sin(angle);
    transform[0] = a * co + c * si; transform[1] = b * co + d * si; transform[2] = c * co - a * si; transform[3] = d * co - b * si;
  };
  ctx.setLineDash = (values) => { dash = values.slice(); record("setLineDash", values); };
  for (const name of ["beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo", "arc", "ellipse", "rect", "fill", "stroke", "clip", "fillRect", "fillText", "drawImage"]) ctx[name] = (...args) => record(name, args);
  ctx.createLinearGradient = (...args) => { record("createLinearGradient", args); return { addColorStop: (...stops) => record("addColorStop", stops) }; };
  const initial = snapshot();
  return { ctx, calls, restored() { assert.equal(stack.length, 0); assert.deepEqual(snapshot(), initial); } };
}
function frozen(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(frozen); }
  return value;
}
const types = ["meadowHare", "bladeMantis", "lanternBeetle", "thornBloom", "galeFalcon", "thunderBison"];
function enemy(type, extra = {}) { return { type, x: 110, y: 224, w: 40, h: 44, hitbox: { x: 110, y: 224, w: 40, h: 44 }, ...extra }; }
function king(phase, extra = {}) { return enemy("boss", { bossVariant: "antlerKing", grassPhase: phase, w: 146, h: 130, ...extra }); }

test("all grass creatures and both new ships render detailed shapes without accessing images", () => {
  const previous = global.wx;
  global.wx = { createImage() { assert.fail("procedural mode must not load images"); } };
  try {
    for (const e of [...types.map((type) => enemy(type)), king(1), king(2)]) {
      const c = canvas();
      assert.equal(visuals.drawGrasslandEnemy(c.ctx, frozen(e), frozen({ elapsed: 1300 })), true);
      assert.ok(c.calls.filter((call) => ["bezierCurveTo", "quadraticCurveTo", "ellipse"].includes(call.name)).length >= 8);
      assert.ok(!c.calls.some((call) => call.name === "drawImage")); c.restored();
    }
    for (const draw of [visuals.drawWindrunnerShape, drawTidecallerShape]) {
      const c = canvas(); assert.equal(draw(c.ctx, 10, 20, 36, 42, frozen({ elapsed: 1400 })), true);
      assert.ok(!c.calls.some((call) => call.name === "drawImage")); c.restored();
    }
    assert.equal(visuals.drawGrasslandEnemy(canvas().ctx, enemy("constructor"), {}), false);
  } finally { global.wx = previous; }
});

test("king pose animates in both phases, honors reduced effects and never mutates collision state", () => {
  for (const phase of [1, 2]) {
    const e = frozen(king(phase)), before = JSON.stringify(e);
    const a = canvas(), b = canvas(), reducedA = canvas(), reducedB = canvas();
    visuals.drawGrasslandEnemy(a.ctx, e, frozen({ elapsed: 1000 }));
    visuals.drawGrasslandEnemy(b.ctx, e, frozen({ elapsed: 1800 }));
    assert.notDeepEqual(a.calls, b.calls);
    visuals.drawGrasslandEnemy(reducedA.ctx, e, frozen({ elapsed: 1000, flashEffectsOn: false }));
    visuals.drawGrasslandEnemy(reducedB.ctx, e, frozen({ elapsed: 1800, flashEffectsOn: false }));
    assert.deepEqual(reducedA.calls, reducedB.calls); assert.equal(JSON.stringify(e), before);
    for (const c of [a, b, reducedA, reducedB]) c.restored();
  }
});

test("grass backgrounds and actual locked attack warnings remain finite across phone and wide sizes", () => {
  for (const width of [320, 390, 768]) {
    for (const phase of ["warn", "active"]) {
      const entries = [
        king(1, { grassState: "warn", grassAttack: "antlerFan", grassWarnProgress: 0.8,
          grassFanOrigins: [{ x: width / 2 - 35, y: 252, angles: [1.2, 1.57, 1.9] }, { x: width / 2 + 35, y: 252, angles: [1.2, 1.57, 1.9] }] }),
        king(2, { grassState: "warn", grassAttack: "hoofStamp", grassWarnProgress: 0.8, grassStampZones: [{ x: width / 2, y: 620, r: 92 }] }),
        king(2, { grassState: "warn", grassAttack: "galeCorridor", grassWarnProgress: 0.8, grassGapCenter: width / 2, grassGapWidth: 108, grassWallY: 354 }),
        ...["bladeMantis", "thunderBison", "thornBloom", "lanternBeetle"].map((type) => enemy(type, { grassAttackPhase: "warn", grassWarnProgress: 0.6, grassAimAngle: 1.5, grassTarget: { x: width / 2, y: 580 } })),
      ];
      const state = frozen({ elapsed: 1400, enemies: entries, grassWindPhase: phase, grassWindPhaseMs: 1400, grassWindDirection: -1, crosswindCfg: { warnMs: 2000, activeMs: 7000 } });
      const c = canvas(); visuals.drawGrasslandBackground(c.ctx, state, width, 844); visuals.drawGrasslandOverlay(c.ctx, state, width, 844); c.restored();
      const labels = c.calls.filter((call) => call.name === "fillText").map((call) => call.args[0]);
      assert.deepEqual(labels, [phase === "warn" ? "横风将至 ←  1s" : "横风 ←  6s"], "only the brief wind-cycle HUD remains textual");
      const ringOnly = canvas(); visuals.drawGrasslandOverlay(ringOnly.ctx, { enemies: [entries[1]] }, width, 844);
      assert.ok(ringOnly.calls.some((call) => call.name === "arc" && call.args[2] === 92));
      assert.ok(!ringOnly.calls.some((call) => call.name === "fill" || call.name === "fillRect"), "outward ring must never imply a filled damaging center");
      ringOnly.restored();
      for (const entry of entries) {
        const graphic = canvas(); visuals.drawGrasslandOverlay(graphic.ctx, { enemies: [entry] }, width, 844);
        assert.ok(!graphic.calls.some((call) => call.name === "fillText"), "combat telegraphs must use visual guides without labels");
        graphic.restored();
      }
    }
    const swatch = canvas(); visuals.drawGrasslandSwatch(swatch.ctx, 0, 0, width, 70, {}); swatch.restored();
  }
});

test("grass atlas is lazy, uses eight distinct measured crops and preserves animated boss render state", () => {
  const previous = global.wx, resolved = require.resolve("../src/grasslandTextures.js");
  delete require.cache[resolved];
  let loads = 0, pending;
  global.wx = { createImage() { loads += 1; pending = { width: 1254, height: 1254 }; return pending; } };
  try {
    const { drawGrasslandTexture, GRASSLAND_ATLAS_LAYOUT: layout } = require(resolved);
    for (const e of [...types.map((type) => enemy(type)), king(1), king(2)]) {
      const c = canvas(); assert.equal(drawGrasslandTexture(c.ctx, frozen(e), {}, false), false); assert.equal(c.calls.length, 0);
    }
    assert.equal(loads, 0);
    assert.equal(drawGrasslandTexture(canvas().ctx, enemy(types[0]), {}, true), false);
    assert.equal(loads, 1); assert.equal(pending.src, layout.path); pending.onload();
    const seen = new Set();
    for (const e of [...types.map((type) => enemy(type)), king(1), king(2)]) {
      const c = canvas(); assert.equal(drawGrasslandTexture(c.ctx, frozen(e), frozen({ elapsed: 1700 }), true), true); c.restored();
      const draws = c.calls.filter((call) => call.name === "drawImage"); assert.ok(draws.length >= 1);
      seen.add(draws[0].args.slice(1, 3).join(","));
      for (const { args } of draws) {
        const [, sx, sy, sw, sh, , , dw, dh] = args;
        assert.ok(sx >= 0 && sy >= 0 && sw > 0 && sh > 0 && sx + sw <= 1254.001 && sy + sh <= 1254.001);
        assert.ok(dw > 0 && dh > 0);
      }
    }
    assert.equal(seen.size, 8); assert.equal(loads, 1);
    for (const phase of [1, 2]) {
      const a = canvas(), b = canvas(), e = frozen(king(phase));
      drawGrasslandTexture(a.ctx, e, { elapsed: 1000 }, true); drawGrasslandTexture(b.ctx, e, { elapsed: 1800 }, true);
      assert.notDeepEqual(a.calls, b.calls); a.restored(); b.restored();
    }
    const c = canvas(); assert.equal(drawGrasslandTexture(c.ctx, king(2), {}, false), false); assert.equal(c.calls.length, 0); assert.equal(loads, 1);
  } finally { global.wx = previous; delete require.cache[resolved]; }
});
