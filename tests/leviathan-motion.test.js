"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");

function loadGame() {
  const context = vm.createContext({
    wx: { getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }) },
  });
  const modules = new Map();
  function load(file) {
    const filename = path.resolve(ROOT, file);
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = { exports: {} };
    modules.set(filename, mod);
    new vm.Script(`(function(require,module,exports){\n${fs.readFileSync(filename, "utf8")}\n})`, { filename })
      .runInContext(context)((request) => load(path.resolve(path.dirname(filename), request)), mod, mod.exports);
    return mod.exports;
  }
  return {
    createBoss: load("src/enemies.js").createBoss,
    updateBoss: load("subpackages/pkg_boss/src/bossAi.js").updateBoss,
  };
}

for (const [frameMs, bulletSpeed] of [[16, 1], [33, 1], [16, 0.55], [33, 0.55]]) {
  test(`Leviathan swims between attacks with truthful locked warnings at ${frameMs}ms / ${bulletSpeed}x bullets`, () => {
    const { createBoss, updateBoss } = loadGame();
    const boss = createBoss("leviathan", 8);
    const state = { elapsed: 0, player: { x: 175, y: 700, w: 32, h: 36 }, enemyBullets: [] };
    const attacks = new Set();
    const motionPhases = new Set();
    const warningXs = [];
    let previousState, warningPosition;
    let clearingTravel = 0;
    let returnFrames = 0;
    let curvedReturnSeen = false;

    for (let elapsed = 0; elapsed < 240000; elapsed += frameMs) {
      state.elapsed = elapsed;
      state.player.x = 175 + Math.sin(elapsed * 0.00073) * 125;
      if (elapsed >= 120000) boss.hp = boss.maxHp * 0.49;
      const beforeX = boss.x, beforeY = boss.y;
      updateBoss(boss, frameMs, state, (bullet) => {
        assert.equal(boss.leviathanState, "fire");
        if (!bullet.leviathanGate) {
          assert.equal(bullet.x + bullet.w / 2, boss.leviathanWarnOrigin.x, "fan origin moved after its warning");
          assert.equal(bullet.y + bullet.h / 2, boss.leviathanWarnOrigin.y, "fan origin moved after its warning");
        }
        state.enemyBullets.push(bullet);
      }, () => {});

      const distance = Math.hypot(boss.x - beforeX, boss.y - beforeY);
      assert.ok(distance <= 13 * frameMs / 16.667 + 1, "movement must not teleport");
      assert.equal(boss.w, 120, "animation must retain the collision width");
      assert.equal(boss.h, 120, "animation must retain the collision height");
      assert.ok(Number.isFinite(boss.leviathanBank) && Math.abs(boss.leviathanBank) <= 0.12001);
      assert.ok(Number.isFinite(boss.leviathanThrust) && boss.leviathanThrust >= 0 && boss.leviathanThrust <= 1);
      assert.ok(Number.isFinite(boss.leviathanSwimPhase));
      motionPhases.add(boss.leviathanMotionPhase);

      const visible = state.enemyBullets.filter((b) => b.leviathanBullet
        && b.y > -30 && b.y < 874 && b.x > -30 && b.x < 420);
      if (boss.leviathanState === "warn") {
        assert.ok(boss.leviathanWarnMs >= 900);
        if (previousState !== "warn") {
          assert.equal(visible.length, 0, "next attack must wait for old gate/fan bullets to clear");
          warningPosition = { x: boss.x, y: boss.y };
          warningXs.push(boss.x);
          attacks.add(`${boss.leviathanPhase}:${boss.leviathanAttack}`);
        } else {
          assert.equal(boss.x, warningPosition.x, "locked warning cannot drift horizontally");
          assert.equal(boss.y, warningPosition.y, "locked warning cannot drift vertically");
        }
      }
      if (boss.leviathanState === "dash" && previousState !== "dash") {
        assert.equal(visible.length, 0, "dash cannot overlap lingering fan bullets");
      }
      if (boss.leviathanState === "fire" && boss.leviathanMotionPhase === "glide") {
        clearingTravel += distance;
        assert.ok(boss.y >= 224 && boss.y <= 844 * 0.38 + 0.0001, "free swimming stays in the upper band");
      }
      if (boss.leviathanMotionPhase === "return") {
        returnFrames += 1;
        const curve = boss.leviathanReturn;
        if (curve) {
          const cross = (boss.x - curve.fromX) * (curve.toY - curve.fromY)
            - (boss.y - curve.fromY) * (curve.toX - curve.fromX);
          if (Math.abs(cross) > 100) curvedReturnSeen = true;
        }
      }
      previousState = boss.leviathanState;
      state.enemyBullets.forEach((b) => { b.x += b.vx * bulletSpeed; b.y += b.vy * bulletSpeed; });
      state.enemyBullets = state.enemyBullets.filter((b) => b.y > -50 && b.y < 900 && b.x > -50 && b.x < 440);
    }

    for (const phase of [1, 2]) for (const attack of ["tideGate", "abyssFan", "breach"]) {
      assert.ok(attacks.has(`${phase}:${attack}`), `no permanent wait before phase ${phase} / ${attack}`);
    }
    for (const motion of ["glide", "windup", "dash", "return"]) assert.ok(motionPhases.has(motion));
    assert.ok(clearingTravel > 1500, "waiting for bullet departure should include visible swimming");
    assert.ok(Math.max(...warningXs) - Math.min(...warningXs) > 150, "successive attacks must use varied lateral anchors");
    assert.ok(returnFrames > 50 && curvedReturnSeen, "breach should end in a visible curved return");
  });
}
