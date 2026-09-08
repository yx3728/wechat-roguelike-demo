"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");

function harness() {
  const context = vm.createContext({ wx: { getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }) } });
  const cache = new Map();
  function load(file) {
    const filename = path.resolve(ROOT, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    new vm.Script(`(function(require,module,exports){\n${fs.readFileSync(filename, "utf8")}\n})`, { filename })
      .runInContext(context)((request) => load(path.resolve(path.dirname(filename), request)), mod, mod.exports);
    return mod.exports;
  }
  return {
    enemies: load("src/enemies.js"),
    habitat: load("src/grasslandMechanics.js"),
    updateBoss: load("subpackages/pkg_boss/src/bossAi.js").updateBoss,
  };
}

test("grassland has five distinct normal enemies and a charging elite, with stationary telegraphs", () => {
  const { enemies, habitat } = harness();
  assert.equal(enemies.ENEMY_POOLS.grassland.length, 5);
  // 草原敌人的行为建立在草丛 / 根芽 / 藤蔓之上，state 必须先初始化栖息地，
  // 否则螳螂找不到草丛、野牛不会冲、花种不出根芽，全卡在 approach。
  const freshState = () => {
    const st = { player: { x: 175, y: 700, w: 32, h: 36 }, elapsed: 0, enemies: [], bullets: [] };
    habitat.initGrasslandHabitat(st, 390, 844);
    return st;
  };
  const cases = ["createMeadowHare", "createBladeMantis", "createLanternBeetle", "createThornBloom", "createGaleFalcon", "createThunderBison"];
  const summaries = {};
  for (const factory of cases) {
    const enemy = enemies[factory](8);
    const state = freshState();
    state.enemies = [enemy];
    const phases = new Set(), armor = new Set();
    let shots = 0, warned = false, previousPhase, warning;
    for (let elapsed = 0; elapsed < 22000; elapsed += 16) {
      state.elapsed = elapsed;
      enemies.updateEnemy(enemy, 16, state);
      enemies.maybeFire(enemy, 16, state, (bullet) => {
        assert.ok(warned, `${enemy.type} shot without a warning`);
        assert.ok([bullet.x, bullet.y, bullet.vx, bullet.vy].every(Number.isFinite));
        assert.equal(bullet.grassBullet, true);
        shots += 1;
      });
      phases.add(enemy.grassAttackPhase);
      armor.add(enemy.damageTakenMul);
      assert.ok([enemy.x, enemy.y, enemy.w, enemy.h].every(Number.isFinite));
      if (enemy.grassAttackPhase === "warn") {
        warned = true;
        if (previousPhase !== "warn") warning = { x: enemy.x, y: enemy.y, target: JSON.stringify(enemy.grassTarget) };
        else {
          assert.equal(enemy.x, warning.x, `${enemy.type} moved during its warning`);
          assert.equal(enemy.y, warning.y, `${enemy.type} moved during its warning`);
          assert.equal(JSON.stringify(enemy.grassTarget), warning.target, "locked target changed");
        }
      }
      previousPhase = enemy.grassAttackPhase;
    }
    summaries[enemy.type] = { phases, shots, armor };
  }
  for (const type of ["bladeMantis", "thunderBison"]) {
    for (const phase of ["warn", "dash", "recover"]) assert.ok(summaries[type].phases.has(phase));
    assert.equal(summaries[type].shots, 0);
  }
  assert.ok(summaries.thunderBison.phases.has("return"));
  assert.ok(summaries.lanternBeetle.shots >= 8);
  assert.ok(summaries.lanternBeetle.armor.has(0.65) && summaries.lanternBeetle.armor.has(1.4));
  assert.ok(summaries.thornBloom.shots >= 9);
  assert.equal(summaries.meadowHare.shots, 0);
  assert.equal(summaries.galeFalcon.shots, 0);
  assert.equal(enemies.createEliteFor("thunderBison", 8).type, "thunderBison");
  assert.equal(enemies.bossCoin("antlerKing"), 1200);
  assert.equal(enemies.bossLeadsToHidden("antlerKing"), false);
});

for (const [frameMs, bulletSpeed] of [[16, 1], [33, 1], [16, 0.55], [33, 0.55]]) {
  test(`Antler King preserves safe corridors, outward stamps and locked fans at ${frameMs}ms/${bulletSpeed}x`, () => {
    const { enemies, updateBoss } = harness();
    const boss = enemies.createBoss("antlerKing", 8);
    const state = { elapsed: 0, player: { x: 175, y: 700, w: 32, h: 36 }, enemyBullets: [] };
    const attacks = new Set(), warningXs = [];
    let lastState, warning, warnMsAtStart, transitionChecked = false, travelWhileClearing = 0, stamped = 0;
    for (let elapsed = 0; elapsed < 240000; elapsed += frameMs) {
      state.elapsed = elapsed;
      state.player.x = 175 + Math.sin(elapsed * 0.00065) * 125;
      if (elapsed >= 120000) boss.hp = boss.maxHp * 0.49;
      if (!transitionChecked && elapsed >= 120000) {
        state.enemyBullets.push({ x: 50, y: 50, w: 4, h: 4, vx: 0, vy: 0, marker: "keep" });
      }
      const beforeX = boss.x, beforeY = boss.y;
      updateBoss(boss, frameMs, state, (bullet) => {
        assert.equal(boss.grassState, "fire");
        assert.equal(bullet.grassBossBullet, true);
        assert.ok([bullet.x, bullet.y, bullet.vx, bullet.vy].every(Number.isFinite));
        const x = bullet.x + bullet.w / 2, y = bullet.y + bullet.h / 2;
        if (boss.grassAttack === "galeCorridor") {
          assert.ok(boss.grassGapWidth >= 108);
          assert.ok(Math.abs(x - boss.grassGapCenter) > boss.grassGapWidth / 2 + bullet.w / 2);
          assert.equal(y, boss.grassWallY);
        } else if (boss.grassAttack === "hoofStamp") {
          const circle = boss.grassStampZones[0];
          const dx = x - circle.x, dy = y - circle.y;
          assert.ok(Math.abs(Math.hypot(dx, dy) - circle.r) < 0.00001, "stamp must spawn on the warned circumference");
          assert.ok(dx * bullet.vx + dy * bullet.vy > 0, "stamp must travel away from its safe center");
          stamped += 1;
        } else {
          const origin = boss.grassFanOrigins.find((point) => Math.abs(point.x - x) < 0.00001 && Math.abs(point.y - y) < 0.00001);
          assert.ok(origin, "fan fired outside its locked antler origin");
          assert.ok(origin.angles.some((angle) => Math.abs(Math.cos(angle) * 2.8 - bullet.vx) < 0.00001
            && Math.abs(Math.sin(angle) * 2.8 - bullet.vy) < 0.00001), "fan ray differs from warning");
        }
        state.enemyBullets.push(bullet);
      }, () => {});
      if (!transitionChecked && elapsed >= 120000) {
        assert.equal(boss.grassPhase, 2);
        assert.equal(boss.grassState, "transition");
        assert.ok(!state.enemyBullets.some((b) => b.grassBossBullet));
        assert.ok(state.enemyBullets.some((b) => b.marker === "keep"));
        transitionChecked = true;
      }
      // 犁地冲锋本来就快（实测 ~6.7px/帧），这里只抓"不连续的瞬移"，不是限速
      assert.ok(Math.hypot(boss.x - beforeX, boss.y - beforeY) < 9 * frameMs / 16.667 + 1, "Boss teleported");
      assert.ok(Number.isFinite(boss.grassBank) && Math.abs(boss.grassBank) <= 0.12001);
      assert.ok(Number.isFinite(boss.grassSwimPhase));
      if (boss.grassState === "warn") {
        // 预警时长按招式与阶段变化（犁地更长），这里只要求它是合理值且同一次预警内不变
        assert.ok(boss.grassWarnMs >= 800 && boss.grassWarnMs <= 1400,
          `warn window out of range: ${boss.grassWarnMs}`);
        if (lastState === "warn") assert.equal(boss.grassWarnMs, warnMsAtStart);
        if (lastState !== "warn") {
          assert.ok(!state.enemyBullets.some((b) => b.grassBossBullet && b.x > -35 && b.x < 425 && b.y > -35 && b.y < 879), "new warning overlaps previous bullets");
          warning = { x: boss.x, y: boss.y };
          warnMsAtStart = boss.grassWarnMs;
          attacks.add(`${boss.grassPhase}:${boss.grassAttack}`);
          warningXs.push(boss.x);
        } else { assert.equal(boss.x, warning.x); assert.equal(boss.y, warning.y); }
      }
      if (boss.grassState === "fire" && boss.grassMotionPhase === "glide") travelWhileClearing += Math.hypot(boss.x - beforeX, boss.y - beforeY);
      lastState = boss.grassState;
      state.enemyBullets.forEach((bullet) => { bullet.x += bullet.vx * bulletSpeed; bullet.y += bullet.vy * bulletSpeed; });
      state.enemyBullets = state.enemyBullets.filter((bullet) => bullet.x > -50 && bullet.x < 440 && bullet.y > -50 && bullet.y < 900);
    }
    for (const phase of [1, 2]) for (const attack of ["antlerFan", "hoofStamp", "galeCorridor"]) assert.ok(attacks.has(`${phase}:${attack}`), "AI must not deadlock between attacks");
    assert.ok(stamped >= 26);
    assert.ok(travelWhileClearing > 1500, "Boss should glide while old bullets leave");
    assert.ok(Math.max(...warningXs) - Math.min(...warningXs) > 100);
  });
}
