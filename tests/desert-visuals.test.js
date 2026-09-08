"use strict";

// node --test tests/desert-visuals.test.js — no browser or optional dependencies.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const TYPES = ["sandmite", "skimmer", "dunecrawler", "rattler", "burrower", "sandworm"];

function loadVisuals(options = {}) {
  const images = [];
  let creates = 0;
  const wx = {
    createImage() {
      creates += 1;
      if (options.forbidImages) throw new Error("procedural mode must not load an image");
      if (options.failCreate) throw new Error("simulated image loader failure");
      const image = { width: 1254, height: 1254, naturalWidth: 1254, naturalHeight: 1254 };
      images.push(image);
      return image;
    },
  };
  const mod = { exports: {} };
  const filename = path.join(ROOT, "src", "desertVisuals.js");
  const source = fs.readFileSync(filename, "utf8");
  const context = vm.createContext({ wx, console });
  new vm.Script(`(function(require,module,exports){\n${source}\n})`, { filename })
    .runInContext(context)((request) => {
      assert.equal(request, "./config.js", "unexpected renderer dependency");
      return { W: 390, H: 844, DPR: 2 };
    }, mod, mod.exports);
  assert.equal(typeof mod.exports.drawDesertEnemyVisual, "function");
  return { draw: mod.exports.drawDesertEnemyVisual, images, get creates() { return creates; } };
}

function recordingCanvas(options = {}) {
  const calls = [];
  const stack = [];
  let transform = [1, 0, 0, 1, 0, 0];
  let dash = [2, 7];
  const styles = {
    globalAlpha: 0.43, fillStyle: "#123456", strokeStyle: "#654321", lineWidth: 3,
    lineCap: "butt", lineJoin: "miter", miterLimit: 10, lineDashOffset: 1,
    globalCompositeOperation: "source-over", imageSmoothingEnabled: false,
    shadowBlur: 0, shadowColor: "transparent", shadowOffsetX: 0, shadowOffsetY: 0,
    font: "12px sans-serif", textAlign: "left", textBaseline: "alphabetic",
  };
  const ctx = { ...styles, canvas: { width: 390, height: 844 } };
  const styleKeys = Object.keys(styles);
  function snapshot() {
    return { styles: Object.fromEntries(styleKeys.map((k) => [k, ctx[k]])), transform: transform.slice(), dash: dash.slice() };
  }
  function record(name, args) {
    for (const arg of args) if (typeof arg === "number") assert.ok(Number.isFinite(arg), `${name} has nonfinite coordinates`);
    for (const number of transform) assert.ok(Number.isFinite(number), `${name} has a nonfinite transform`);
    assert.ok(Number.isFinite(ctx.globalAlpha), "nonfinite alpha");
    calls.push({ name, args: Array.from(args) });
  }
  ctx.save = () => { stack.push(snapshot()); record("save", []); };
  ctx.restore = () => {
    assert.ok(stack.length, "Canvas restore without save");
    const saved = stack.pop();
    Object.assign(ctx, saved.styles);
    transform = saved.transform;
    dash = saved.dash;
    record("restore", []);
  };
  ctx.translate = (x, y) => {
    record("translate", [x, y]);
    transform[4] += transform[0] * x + transform[2] * y;
    transform[5] += transform[1] * x + transform[3] * y;
  };
  ctx.scale = (x, y) => {
    record("scale", [x, y]);
    transform[0] *= x; transform[1] *= x; transform[2] *= y; transform[3] *= y;
  };
  ctx.rotate = (angle) => {
    record("rotate", [angle]);
    const [a, b, c, d] = transform;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    transform[0] = a * cos + c * sin; transform[1] = b * cos + d * sin;
    transform[2] = c * cos - a * sin; transform[3] = d * cos - b * sin;
  };
  ctx.setLineDash = (values) => { record("setLineDash", values); dash = Array.from(values); };
  ctx.getLineDash = () => dash.slice();
  for (const name of ["beginPath", "closePath", "moveTo", "lineTo", "bezierCurveTo", "quadraticCurveTo",
    "arc", "arcTo", "ellipse", "rect", "roundRect", "fill", "stroke", "clip", "fillRect", "strokeRect", "fillText", "strokeText"]) {
    ctx[name] = (...args) => record(name, args);
  }
  for (const name of ["createLinearGradient", "createRadialGradient"]) {
    ctx[name] = (...args) => {
      record(name, args);
      return { addColorStop(position, color) { record("addColorStop", [position, color]); assert.ok(position >= 0 && position <= 1); } };
    };
  }
  ctx.drawImage = (...args) => {
    record("drawImage", args);
    if (options.forbidImages) throw new Error("procedural mode must not draw an image");
  };
  const initial = snapshot();
  return {
    ctx, calls,
    assertRestored() {
      assert.equal(stack.length, 0, "unbalanced Canvas save/restore");
      assert.deepEqual(snapshot(), initial, "renderer leaked Canvas state");
    },
  };
}

function enemy(type, extra = {}) {
  return {
    type, x: 120, y: 230, w: 46, h: 44, vx: -1.6,
    hp: 3000, maxHp: 4000, color: "#a3a3a3", burrowPhase: "up", wormPhase: "up",
    wormTimer: 320, isSandworm: type === "sandworm", isElite: type === "sandworm",
    ...extra,
  };
}

function variants() {
  return [
    ...TYPES.map((type) => enemy(type)),
    enemy("burrower", { burrowPhase: "under", untargetable: true }),
    enemy("sandworm", { wormPhase: "under", untargetable: true }),
    enemy("sandworm", { wormPhase: "telegraph", untargetable: true }),
    enemy("boss", { bossVariant: "hanba", isBoss: true, w: 120, h: 120 }),
    enemy("boss", { bossVariant: "hanba", isBoss: true, w: 120, h: 120, preDiveWarn: true }),
    enemy("boss", { bossVariant: "hanba", isBoss: true, w: 120, h: 120, hpBarBreakFlashMs: 200, bossLaserWarn: true, bossLaserAng: 1.1 }),
  ];
}

function renderAndCheck(env, item, state, texturesEnabled, forbidImages = false) {
  const before = JSON.stringify({ item, state });
  const canvas = recordingCanvas({ forbidImages });
  assert.equal(env.draw(canvas.ctx, item, state, texturesEnabled), true, `${item.type}/${item.wormPhase} must be handled`);
  canvas.assertRestored();
  assert.equal(JSON.stringify({ item, state }), before, "drawing mutated gameplay state");
  return canvas.calls;
}

function assertProcedural(calls) {
  const geometry = calls.filter((c) => ["moveTo", "lineTo", "bezierCurveTo", "quadraticCurveTo", "arc", "ellipse", "rect", "roundRect"].includes(c.name));
  assert.ok(geometry.length >= 5, "fallback must draw a recognizable creature, not only a marker");
  assert.ok(calls.filter((c) => c.name === "fill" || c.name === "stroke").length >= 2, "fallback needs a painted body with detail");
  assert.equal(calls.filter((c) => c.name === "drawImage").length, 0);
}

test("all desert creatures and Hanba render substantial image-free paths with textures disabled", () => {
  const env = loadVisuals({ forbidImages: true });
  for (const flashEffectsOn of [true, false]) {
    for (const item of variants()) {
      const calls = renderAndCheck(env, item, { elapsed: 4571, flashEffectsOn }, false, true);
      assertProcedural(calls);
    }
  }
  assert.equal(env.creates, 0, "turning textures off must bypass the image loader entirely");
});

test("unsupported enemies and invalid sizes leave Canvas and image loader untouched", () => {
  const env = loadVisuals({ forbidImages: true });
  for (const item of [null, enemy("grunt"), enemy("boss", { bossVariant: "crimson" }), enemy("sandmite", { w: 0 }), enemy("sandworm", { h: 0 })]) {
    for (const textures of [false, true]) {
      const canvas = recordingCanvas({ forbidImages: true });
      assert.equal(env.draw(canvas.ctx, item, {}, textures), false);
      assert.equal(canvas.calls.length, 0);
      canvas.assertRestored();
    }
  }
  assert.equal(env.creates, 0);
});

test("pending and failed atlas loads retain the procedural creature without repeated requests", () => {
  const env = loadVisuals();
  for (const item of variants()) assertProcedural(renderAndCheck(env, item, { elapsed: 200 }, true));
  assert.equal(env.creates, 1, "one shared pending atlas request");
  assert.equal(typeof env.images[0].onerror, "function");
  env.images[0].onerror();
  for (const item of variants()) assertProcedural(renderAndCheck(env, item, { elapsed: 400 }, true));
  assert.equal(env.creates, 1, "failed loader respects retry cooldown");

  const unavailable = loadVisuals({ failCreate: true });
  assertProcedural(renderAndCheck(unavailable, enemy("sandworm"), {}, true));
  assert.equal(unavailable.creates, 1);
});

test("ready textures use valid atlas cells and switching them off immediately restores procedural paths", () => {
  const png = fs.readFileSync(path.join(ROOT, "subpackages", "pkg_assets", "images", "desert-enemies-atlas.png"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1254);
  assert.equal(png.readUInt32BE(20), 1254);
  assert.equal(png[24], 8, "atlas must have 8-bit channels");
  assert.equal(png[25], 6, "atlas must preserve RGBA transparency");

  const env = loadVisuals();
  renderAndCheck(env, enemy("sandmite"), {}, true);
  const image = env.images[0];
  assert.match(image.src, /desert-enemies-atlas\.png$/);
  image.onload();
  const cells = new Set();
  for (const item of variants()) {
    const calls = renderAndCheck(env, item, { elapsed: 1500, flashEffectsOn: false }, true);
    const sprites = calls.filter((call) => call.name === "drawImage");
    assert.equal(sprites.length, 1);
    const [atlas, sx, sy, sw, sh, dx, dy, dw, dh] = sprites[0].args;
    assert.equal(atlas, image);
    assert.ok([sx, sy, sw, sh, dx, dy, dw, dh].every(Number.isFinite));
    assert.ok(sx >= 0 && sy >= 0 && sw > 0 && sh > 0 && sx + sw <= 1254 && sy + sh <= 1254);
    assert.ok(dw > 0 && dh > 0);
    // Generated artwork uses measured transparent bounds, not equal 418px tiles.
    cells.add(`${sx}:${sy}:${sw}:${sh}`);
  }
  assert.equal(cells.size, 9, "six enemies, Hanba and two submerged variants need distinct cells");
  for (const item of variants()) assertProcedural(renderAndCheck(env, item, {}, false, true));
  assert.equal(env.creates, 1, "texture toggle reuses the shared loader");
});
