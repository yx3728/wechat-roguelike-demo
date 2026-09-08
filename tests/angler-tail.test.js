"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { drawOceanEnemy, drawOceanOverlay } = require("../src/oceanVisuals.js");

function textureRuntime(ready) {
  const requests = [];
  const wx = { createImage() {
    const image = { width: 1254, height: 1254 };
    Object.defineProperty(image, "src", { set(value) { requests.push(value); if (ready) image.onload(); } });
    return image;
  } };
  const mod = { exports: {} };
  const filename = path.resolve(__dirname, "../src/enemyTextures.js");
  const wrapper = new vm.Script(`(function(module,exports){${fs.readFileSync(filename, "utf8")}\n})`, { filename });
  wrapper.runInContext(vm.createContext({ wx }))(mod, mod.exports);
  return { draw: mod.exports.drawEnemyTexture, requests };
}
function canvas() {
  const calls = [], stack = [];
  const props = { globalAlpha: 0.61, fillStyle: "#123", strokeStyle: "#456", lineWidth: 2,
    imageSmoothingEnabled: false, lineCap: "butt", lineJoin: "miter" };
  const keys = Object.keys(props);
  const style = () => Object.fromEntries(keys.map((key) => [key, props[key]]));
  const before = style();
  props.save = () => stack.push(style());
  props.restore = () => { assert.ok(stack.length); Object.assign(props, stack.pop()); };
  const ctx = new Proxy(props, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => {
      for (const arg of args) if (typeof arg === "number") assert.ok(Number.isFinite(arg), `${String(name)} used nonfinite geometry`);
      calls.push({ name, args, alpha: props.globalAlpha });
    };
  } });
  return { ctx, calls, restored() { assert.equal(stack.length, 0); assert.deepEqual(style(), before); } };
}
function angler() {
  return Object.freeze({ type: "abyssalAngler", isElite: true, x: 90, y: 220, w: 64, h: 58,
    oceanAttackPhase: "warn", oceanWarnProgress: 0.7, oceanAimAngle: 1.2,
    hitbox: Object.freeze({ x: 90, y: 220, w: 64, h: 58 }) });
}

test("angler texture bends its upper tail while lower head, lure and collision coordinates stay fixed", () => {
  const runtime = textureRuntime(true), enemy = angler(), before = JSON.stringify(enemy);
  const a = canvas(), b = canvas();
  runtime.draw(a.ctx, enemy, Object.freeze({ elapsed: 1000 }), true);
  runtime.draw(b.ctx, enemy, Object.freeze({ elapsed: 1800 }), true);
  const first = a.calls.filter((call) => call.name === "drawImage"), second = b.calls.filter((call) => call.name === "drawImage");
  assert.equal(first.length, 16); assert.equal(second.length, 16); assert.equal(runtime.requests.length, 1);
  const upper = first.filter((_, i) => i < 7);
  assert.ok(upper.some((call, i) => call.args[5] !== second[i].args[5]), "tail strips must sway laterally over time");
  for (let i = 8; i < first.length; i += 1) assert.deepEqual(first[i], second[i], "lower head/lure strips must remain fixed");
  assert.ok(!a.calls.some((call) => call.name === "rotate" || call.name === "scale"), "tail motion must not rotate or scale the whole fish");
  for (const draws of [first, second]) for (const { args, alpha } of draws) {
    const [, sx, sy, sw, sh, dx, , dw] = args;
    assert.ok(sx >= 890 && sx + sw <= 1223.001 && sy >= 416 && sy + sh <= 801.001);
    assert.ok(Math.abs(dx + dw / 2) <= 3.4, "tail sway remains subtle at the real elite size");
    assert.equal(alpha, 0.61);
  }
  assert.equal(JSON.stringify(enemy), before); a.restored(); b.restored();
  const stillA = canvas(), stillB = canvas();
  runtime.draw(stillA.ctx, enemy, { elapsed: 1000, flashEffectsOn: false }, true);
  runtime.draw(stillB.ctx, enemy, { elapsed: 1800, flashEffectsOn: false }, true);
  assert.deepEqual(stillA.calls, stillB.calls); assert.equal(stillA.calls.filter((call) => call.name === "drawImage").length, 1);
  stillA.restored(); stillB.restored();
});

test("procedural angler tail moves independently of head and lure, including when textures are disabled or pending", () => {
  const runtime = textureRuntime(false), enemy = angler(), a = canvas(), b = canvas();
  assert.equal(runtime.draw(a.ctx, enemy, { elapsed: 1000 }, false), false); assert.equal(runtime.requests.length, 0);
  assert.equal(drawOceanEnemy(a.ctx, enemy, { elapsed: 1000 }), true);
  assert.equal(runtime.draw(b.ctx, enemy, { elapsed: 1800 }, true), false); assert.equal(runtime.requests.length, 1);
  assert.equal(drawOceanEnemy(b.ctx, enemy, { elapsed: 1800 }), true);
  assert.ok(!a.calls.concat(b.calls).some((call) => call.name === "drawImage"));
  const tailCurve = (c) => c.calls.find((call) => call.name === "quadraticCurveTo").args;
  assert.notDeepEqual(tailCurve(a), tailCurve(b));
  const head = (c) => c.calls.filter((call) => call.name === "ellipse");
  assert.deepEqual(head(a), head(b), "head/mouth ellipses must not follow tail motion");
  const lureStem = (c) => c.calls.filter((call) => call.name === "bezierCurveTo" && call.args[5] === -34);
  assert.equal(lureStem(a).length, 1); assert.deepEqual(lureStem(a), lureStem(b));
  a.restored(); b.restored();
  const stillA = canvas(), stillB = canvas();
  drawOceanEnemy(stillA.ctx, enemy, { elapsed: 1000, flashEffectsOn: false });
  drawOceanEnemy(stillB.ctx, enemy, { elapsed: 1800, flashEffectsOn: false });
  assert.deepEqual(stillA.calls, stillB.calls); stillA.restored(); stillB.restored();
  const overlay = canvas(); drawOceanOverlay(overlay.ctx, { enemies: [enemy] }, 390, 844);
  assert.equal(overlay.calls.length, 0, "tail animation must not restore removed angler warning guides"); overlay.restored();
});
