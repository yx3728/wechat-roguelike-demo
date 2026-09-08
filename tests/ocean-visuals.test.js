"use strict";

// node --test tests/ocean-visuals.test.js — checks rendering contracts without a browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const { drawOceanBackground, drawOceanEnemy, drawOceanOverlay, drawOceanSwatch } = require("../src/oceanVisuals.js");

function recordingCanvas() {
  const calls = [];
  const stack = [];
  const ctx = {
    globalAlpha: 0.43, fillStyle: "#123456", strokeStyle: "#654321", lineWidth: 3,
    lineCap: "butt", lineJoin: "miter", miterLimit: 10, lineDashOffset: 1,
    globalCompositeOperation: "source-over", imageSmoothingEnabled: false,
    shadowBlur: 0, shadowColor: "transparent", shadowOffsetX: 0, shadowOffsetY: 0,
    font: "12px sans-serif", textAlign: "left", textBaseline: "alphabetic",
  };
  const styleKeys = Object.keys(ctx);
  let transform = [1, 0, 0, 1, 0, 0];
  let dash = [2, 7];
  function snapshot() {
    return {
      styles: Object.fromEntries(styleKeys.map((key) => [key, ctx[key]])),
      transform: transform.slice(), dash: dash.slice(),
    };
  }
  function record(name, args) {
    for (const arg of args) if (typeof arg === "number") assert.ok(Number.isFinite(arg), `${name}: nonfinite coordinate`);
    assert.ok(transform.every(Number.isFinite), `${name}: nonfinite transform`);
    assert.ok(Number.isFinite(ctx.globalAlpha) && ctx.globalAlpha >= 0 && ctx.globalAlpha <= 1, `${name}: invalid alpha`);
    assert.ok(Number.isFinite(ctx.lineWidth) && ctx.lineWidth > 0, `${name}: invalid line width`);
    if (name === "arc") assert.ok(args[2] >= 0, "negative arc radius");
    if (name === "ellipse") assert.ok(args[2] >= 0 && args[3] >= 0, "negative ellipse radius");
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
      return { addColorStop(position, color) {
        record("addColorStop", [position, color]);
        assert.ok(position >= 0 && position <= 1, "invalid gradient stop");
      } };
    };
  }
  ctx.drawImage = () => assert.fail("ocean rendering must remain image-free");
  const initial = snapshot();
  return {
    ctx, calls,
    assertRestored() {
      assert.equal(stack.length, 0, "unbalanced Canvas save/restore");
      assert.deepEqual(snapshot(), initial, "renderer leaked styles, transform or line dash");
    },
  };
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

function boss(phase, W = 390, extra = {}) {
  return {
    type: "boss", isBoss: true, bossVariant: "leviathan",
    x: W / 2 - 76, y: 224, w: 152, h: 128,
    hp: phase === 1 ? 80000 : 40000, maxHp: 100000,
    hitbox: { x: W / 2 - 76, y: 224, w: 152, h: 128 },
    leviathanPhase: phase, leviathanState: "idle", leviathanWarnProgress: 0.63,
    leviathanAimAngle: 1.22, leviathanGapX: W * 0.74, leviathanGapW: 108,
    leviathanWallY: 352, leviathanDashTo: { x: W * 0.72, y: 524 },
    ...extra,
  };
}

function renderEnemy(item, state) {
  freeze(item); freeze(state);
  const before = JSON.stringify({ item, state });
  const canvas = recordingCanvas();
  assert.equal(drawOceanEnemy(canvas.ctx, item, state), true);
  canvas.assertRestored();
  assert.equal(JSON.stringify({ item, state }), before, "animation changed collision or gameplay state");
  return canvas.calls;
}

function renderOverlay(state, W, H = 844) {
  freeze(state);
  const before = JSON.stringify(state);
  const canvas = recordingCanvas();
  drawOceanOverlay(canvas.ctx, state, W, H);
  canvas.assertRestored();
  assert.equal(JSON.stringify(state), before, "warning changed gameplay state");
  return canvas.calls;
}

test("Leviathan animates both phases without changing its hitbox or gameplay data", () => {
  const poses = [];
  for (const phase of [1, 2]) {
    for (const mode of ["idle", "warn", "dash", "recover"]) {
      const item = boss(phase, 390, { leviathanState: mode });
      const first = renderEnemy(item, { elapsed: 1000, flashEffectsOn: true });
      const second = renderEnemy(item, { elapsed: 1800, flashEffectsOn: true });
      assert.notDeepEqual(second, first, `phase ${phase} ${mode} must visibly animate over time`);
      if (mode === "idle") poses.push(first);
    }
  }
  assert.notDeepEqual(poses[0], poses[1], "two phases need visibly different anatomy");
});

test("reduced effects freeze decorative Boss motion while preserving its warning pose", () => {
  for (const phase of [1, 2]) {
    const idle = boss(phase);
    const still = renderEnemy(idle, { elapsed: 1000, flashEffectsOn: false });
    assert.deepEqual(renderEnemy(idle, { elapsed: 1800, flashEffectsOn: false }), still);
    const warning = boss(phase, 390, { leviathanState: "warn", leviathanWarnProgress: 0.8 });
    const telegraph = renderEnemy(warning, { elapsed: 1000, flashEffectsOn: false });
    assert.notDeepEqual(telegraph, still, "turning motion off must retain the attack preparation cue");
    assert.deepEqual(renderEnemy(warning, { elapsed: 1800, flashEffectsOn: false }), telegraph);
  }
});

test("all Boss attacks and tide phases render safely across phone and tablet widths", () => {
  for (const W of [320, 390, 768]) {
    for (const phase of [1, 2]) {
      for (const attack of ["tideGate", "abyssFan", "breach"]) {
        for (const flashEffectsOn of [true, false]) {
          for (const tidePhase of ["warn", "active"]) {
            const item = boss(phase, W, { leviathanState: "warn", leviathanAttack: attack });
            const state = {
              elapsed: 1800, flashEffectsOn, enemies: [item],
              tideCfg: { warnMs: 2200, activeMs: 8000 }, tidePhase,
              tideActive: tidePhase === "active", tideTimerMs: 1400,
              tideDirection: tidePhase === "warn" ? -1 : 1,
            };
            const calls = renderOverlay(state, W);
            assert.ok(calls.some((call) => call.name === "stroke"), "warning must remain visible");
            assert.ok(calls.some((call) => call.name === "fillText"), "tide phase needs its readable label");
          }
        }
      }
    }
  }
});

test("tide warning counts down from elapsed phase time and its bar shrinks", () => {
  for (const W of [320, 390, 768]) {
    const outputs = [0, 1400, 2200].map((tideTimerMs) => renderOverlay({
      elapsed: 2000, flashEffectsOn: false, enemies: [],
      tideCfg: { warnMs: 2200, activeMs: 8000 }, tidePhase: "warn",
      tideActive: false, tideDirection: 1, tideTimerMs,
    }, W));
    const label = (calls) => calls.find((call) => call.name === "fillText").args[0];
    assert.match(label(outputs[0]), /3s$/, "phase start must show ceil(2200ms)=3s");
    assert.match(label(outputs[1]), /1s$/, "1400ms elapsed leaves 800ms, displayed as 1s");
    assert.match(label(outputs[2]), /0s$/, "finished phase cannot display time remaining");
    // The progress indicator is the only thin filled rectangle in the tide-only overlay.
    const barWidth = (calls) => calls.find((call) => call.name === "fillRect" && call.args[3] <= 3).args[2];
    assert.ok(barWidth(outputs[0]) > barWidth(outputs[1]));
    assert.equal(barWidth(outputs[2]), 0);
  }
});

test("angler has no field-warning overlay while its animated body remains visible", () => {
  const item = { type: "abyssalAngler", x: 110, y: 250, w: 64, h: 68,
    oceanAttackPhase: "warn", oceanWarnProgress: 0.8, oceanAimAngle: 1.1 };
  for (const W of [320, 390, 768]) {
    const calls = renderOverlay({ elapsed: 1000, enemies: [item] }, W);
    assert.deepEqual(calls.map((call) => call.name), ["save", "restore"], "angler must emit no warning paths, rings or text");
  }
  const first = renderEnemy(item, { elapsed: 1000 }), second = renderEnemy(item, { elapsed: 1800 });
  assert.ok(first.some((call) => call.name === "fill"), "angler anatomy must still be drawn");
  assert.notDeepEqual(first, second, "angler body animation is retained");
});

test("ocean attack guides contain no safe-gap instructions or atmospheric text labels", () => {
  for (const W of [320, 390, 768]) {
    for (const attack of ["tideGate", "abyssFan", "breach"]) {
      const item = boss(2, W, { leviathanState: "warn", leviathanAttack: attack });
      const calls = renderOverlay({ elapsed: 1000, enemies: [item] }, W);
      assert.ok(calls.some((call) => call.name === "stroke"), "visual attack guides remain");
      assert.ok(!calls.some((call) => call.name === "fillText"), "attack guides must not draw textual labels");
    }
  }
});

test("backgrounds, map swatches and regular enemy warnings preserve Canvas state", () => {
  const types = ["reefRay", "needlefish", "jellyfish", "armoredCrab", "inkCuttlefish", "abyssalAngler"];
  for (const W of [320, 390, 768]) {
    for (const flashEffectsOn of [true, false]) {
      const enemies = types.map((type, i) => ({ type, x: 24 + i * W / 8, y: 280, w: 32, h: 38,
        oceanAttackPhase: "warn", oceanWarnProgress: 0.8, oceanAimAngle: 1.14, oceanShellOpen: true }));
      const state = freeze({ elapsed: 1800, flashEffectsOn, enemies,
        themeFrom: { bg: "#063b4b", star: "#246a73" }, themeTo: { bg: "#071a32", star: "#267988" }, themeBlendT: 0.5 });
      const before = JSON.stringify(state);
      const canvas = recordingCanvas();
      drawOceanBackground(canvas.ctx, state, W, 844);
      canvas.assertRestored();
      drawOceanOverlay(canvas.ctx, state, W, 844);
      canvas.assertRestored();
      for (const item of enemies) renderEnemy(item, state);
      drawOceanSwatch(canvas.ctx, 12, 30, W - 24, 66, state.themeTo);
      canvas.assertRestored();
      assert.equal(JSON.stringify(state), before);
    }
  }
});
