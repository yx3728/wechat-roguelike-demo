"use strict";

// Exercise the real battle loop and save module in an isolated WeChat-like VM.
// Only this test exposes the battle closures; no production test API is required.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");

function harness(rawSave) {
  const writes = [];
  let seed = 41937;
  const math = Object.create(Math);
  math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const wx = {
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
    getStorageSync: () => rawSave && JSON.parse(JSON.stringify(rawSave)),
    setStorageSync: (key, value) => writes.push({ key, value: JSON.parse(JSON.stringify(value)) }),
    createImage: () => ({}),
    createInnerAudioContext: () => ({ onError() {}, play() {}, pause() {}, stop() {}, seek() {} }),
  };
  const context = vm.createContext({ wx, Math: math, console });
  const cache = new Map();
  function load(relative) {
    let filename = path.resolve(ROOT, relative);
    if (!path.extname(filename)) filename += ".js";
    if (cache.has(filename)) return cache.get(filename).exports;
    let source = fs.readFileSync(filename, "utf8");
    if (filename === path.join(ROOT, "src", "battle.js")) {
      const marker = /  return \{\r?\n    update,\r?\n    draw,/g;
      assert.equal((source.match(marker) || []).length, 1, "battle test seam must match exactly once");
      source = source.replace(marker, `  return {
    __test: { state, fireBullets, updateMechanics, gainExp, consumeItem, triggerBomb },
    update,
    draw,`);
    }
    const mod = { exports: {} };
    cache.set(filename, mod);
    new vm.Script(`(function(require, module, exports) {\n${source}\n})`, { filename })
      .runInContext(context)((request) => {
        assert.ok(request.startsWith("."), `unexpected runtime dependency: ${request}`);
        return load(path.resolve(path.dirname(filename), request));
      }, mod, mod.exports);
    return mod.exports;
  }
  return { load, writes };
}

function battle(mapId = "grassland", debug) {
  const env = harness({
    selectedMapId: mapId, musicOn: false,
    unlockedMaps: { grassland: true, desert: true },
    unlockedCharacters: { windrunner: false, tidecaller: false },
  });
  const character = env.load("src/characters.js").CHARACTERS[0];
  const scene = env.load("src/battle.js").createBattleScene({ character, onExit() {}, debug });
  const state = scene.__test.state;
  Object.assign(state, { godMode: true, spawnTimer: -1000000, shootInterval: 1000000000, expToNext: 1000000000 });
  return { ...env, scene, state, hooks: scene.__test };
}

function apply(env, ...ids) {
  const pool = env.load("src/upgrades.js").UPGRADE_POOL;
  for (const id of ids) {
    const upgrade = pool.find((u) => u.id === id);
    assert.ok(upgrade && upgrade.available(env.state), `${id} must be available`);
    upgrade.apply(env.state);
  }
}

function forceWind(env, active) {
  env.state.devMechanics.crosswind = active ? "on" : "off";
  env.hooks.updateMechanics(0);
}

function target(env, kind = "normal") {
  const E = env.load("src/enemies.js");
  const enemy = kind === "boss" ? E.createBoss("antlerKing", 1)
    : kind === "elite" ? E.createThunderBison(1) : E.createMeadowHare(1);
  Object.assign(enemy, {
    x: 100, y: 100, speed: 0, vx: 0, hp: 1000000, maxHp: 1000000,
    damageTakenMul: 1, fireCooldown: 1000000, entered: true,
    currentAttack: null, attackTimer: 1000000, grassState: "idle", grassTimer: 1000000,
  });
  env.state.enemies = [enemy];
  return enemy;
}

function hitWithMainBullet(env, enemy) {
  env.hooks.fireBullets();
  Object.assign(env.state.bullets[0], {
    x: enemy.x - 5, y: enemy.y - 5, w: enemy.w + 20, h: enemy.h + 20, vx: 0, vy: 0,
  });
  const hp = enemy.hp;
  env.scene.update(16);
  return hp - enemy.hp;
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
}

test("unlocked grassland initializes its own crosswind and six exclusive, prerequisite-aware hexes", () => {
  const env = battle();
  assert.equal(env.state.mapId, "grassland");
  assert.equal(env.state.mapEnemyPool, "grassland");
  assert.equal(env.state.mapEliteType, "thunderBison");
  assert.deepEqual(JSON.parse(JSON.stringify(env.state.crosswindCfg)), {
    calmMs: 16000, warnMs: 2000, activeMs: 7000, driftPxPerSec: 18, expMul: 1.15,
  });
  assert.equal(env.state.grassWindPhase, "calm");
  assert.equal(env.state.grassWindActive, false);
  assert.equal(env.state.grassWindDirection, 1);
  assert.equal(env.state.tideCfg, null);
  assert.equal(env.state.sandstormCfg, null);
  const hexes = env.load("src/upgrades.js").UPGRADE_POOL.filter((u) => u.maps && u.maps.includes("grassland"));
  assert.deepEqual(Array.from(hexes, (u) => u.id).sort(), [
    "grass_bloom", "grass_gale", "grass_hunter", "grass_roots", "grass_seed", "grass_tailwind",
  ]);
  assert.equal(hexes.find((u) => u.id === "grass_gale").available(env.state), false);
  for (const mapId of ["starfield", "desert", "ocean"]) {
    const other = battle(mapId);
    assert.equal(other.state.crosswindCfg, null);
    assert.ok(hexes.every((u) => !u.available(other.state)), `${mapId} cannot offer grassland hexes`);
  }
  apply(env, "grass_tailwind", "grass_gale", "grass_seed", "grass_roots", "grass_bloom", "grass_hunter");
  assert.ok(hexes.every((u) => !u.available(env.state)), "one-time hexes cannot be picked twice");
});

test("crosswind moves the player and touch anchor by actual clamped displacement; roots remove drift and add health", () => {
  const env = battle();
  forceWind(env, true);
  const { state, hooks } = env;
  Object.assign(state, { touchActive: true, touchOffsetX: 30 });
  state.player.x = 100;
  hooks.updateMechanics(1000);
  assert.equal(state.player.x, 118);
  assert.equal(state.touchOffsetX, 12);
  state.grassWindDirection = -1;
  hooks.updateMechanics(1000);
  assert.equal(state.player.x, 100);
  assert.equal(state.touchOffsetX, 30);
  state.player.x = 2;
  hooks.updateMechanics(1000);
  assert.equal(state.player.x, 0);
  assert.equal(state.touchOffsetX, 32, "left clamp moves the anchor by 2, not 18");
  state.grassWindDirection = 1;
  state.player.x = 390 - state.player.w - 3;
  hooks.updateMechanics(1000);
  assert.equal(state.player.x, 390 - state.player.w);
  assert.equal(state.touchOffsetX, 29, "right clamp moves the anchor by 3");
  const maxHp = state.maxHp;
  state.hp = 1000;
  apply(env, "grass_roots");
  near(state.maxHp, maxHp * 1.15, "roots add 15% max HP");
  assert.equal(state.hp, 1000 + maxHp * 0.15);
  state.player.x = 100;
  hooks.updateMechanics(1000);
  assert.equal(state.player.x, 100);
  assert.equal(state.touchOffsetX, 29);
});

test("crosswind continues during Boss combat and consumes each end-heal boundary exactly once", () => {
  const env = battle();
  apply(env, "grass_bloom");
  const { state, hooks } = env;
  state.hp = 1000;
  state.bossActive = state.wave3BossSpawned = true;
  hooks.updateMechanics(15999);
  assert.equal(state.grassWindPhase, "calm");
  hooks.updateMechanics(1);
  assert.equal(state.grassWindPhase, "warn");
  hooks.updateMechanics(2000);
  assert.equal(state.mechanicsSuspended, true);
  assert.equal(state.grassWindActive, true);
  assert.equal(state.hp, 1000);
  hooks.updateMechanics(7000);
  assert.equal(state.grassWindPhase, "calm");
  assert.equal(state.grassWindDirection, -1);
  const heal = state.maxHp * 0.05;
  assert.equal(state.hp, 1000 + heal);
  hooks.updateMechanics(0);
  hooks.updateMechanics(1);
  assert.equal(state.hp, 1000 + heal);
  hooks.updateMechanics(50000);
  assert.equal(state.grassWindPhaseMs, 1, "large deltas retain remainder across complete cycles");
  assert.equal(state.hp, 1000 + heal * 3, "two crossed end edges heal twice, then are consumed");
  hooks.updateMechanics(0);
  assert.equal(state.hp, 1000 + heal * 3);
});

test("upgrade selection freezes elapsed time, crosswind, player and enemy movement", () => {
  const env = battle();
  forceWind(env, true);
  const enemy = target(env);
  env.state.expToNext = 5;
  env.hooks.gainExp(5);
  assert.equal(env.state.pausedForUpgrade, true);
  const snapshot = () => [env.state.elapsed, env.state.grassWindPhaseMs, env.state.grassWindDirection,
    env.state.player.x, enemy.x, enemy.y, enemy.grassAge];
  const before = snapshot();
  env.scene.update(1000);
  assert.deepEqual(snapshot(), before);
  assert.equal(env.state.upgradeOptions.length, 3);
});

test("wind seed and tailwind apply experience and fire-rate bonuses only during active wind", () => {
  const env = battle();
  apply(env, "grass_seed", "grass_tailwind");
  env.state.expMul = 2;
  env.state.expOrbValueMul = 2;
  const orb = { type: "exp_medium", expValue: 10 };
  env.hooks.consumeItem(orb);
  assert.equal(env.state.exp, 40);
  forceWind(env, true);
  env.hooks.consumeItem(orb);
  assert.equal(env.state.exp, 40 + Math.round(40 * 1.15 * 1.35), "map and hex multipliers stack before integer XP rounding");
  forceWind(env, false);
  env.hooks.consumeItem(orb);
  assert.equal(env.state.exp, 80 + Math.round(40 * 1.15 * 1.35), "calm collection receives no wind bonus");
  env.state.shootInterval = 1200;
  env.scene.update(1000);
  assert.equal(env.state.bullets.length, 0);
  env.state.shootTimer = 0;
  forceWind(env, true);
  env.scene.update(1000);
  assert.equal(env.state.bullets.length, 1, "1200 / 1.25 ms cadence fires within 1000 ms");
  forceWind(env, false);
  env.state.bullets = [];
  env.state.shootTimer = 0;
  env.scene.update(1000);
  assert.equal(env.state.bullets.length, 0, "fire cadence returns to the calm threshold");
});

test("gale amplifies real primary collisions against normal, elite and Boss targets; hunter respects target classes", () => {
  for (const kind of ["normal", "elite", "boss"]) {
    const env = battle();
    apply(env, "grass_tailwind", "grass_gale", "grass_hunter");
    const enemy = target(env, kind);
    const calm = kind === "boss" ? 780 : kind === "elite" ? 960 : 1000;
    assert.equal(hitWithMainBullet(env, enemy), calm, `${kind} calm damage`);
    forceWind(env, true);
    assert.equal(hitWithMainBullet(env, enemy), Math.floor(calm * 1.35), `${kind} wind damage`);
    forceWind(env, false);
    assert.equal(hitWithMainBullet(env, enemy), calm, `${kind} returns to calm damage`);
  }
});

test("gale reaches satellite, bomb and reflection damage through actual battle collision paths", () => {
  const satellite = battle();
  apply(satellite, "sat_orbit", "grass_tailwind", "grass_gale", "grass_hunter", "grass_roots");
  forceWind(satellite, true);
  const elite = target(satellite, "elite");
  Object.assign(satellite.state, { satelliteCount: 1, satelliteOrbitRadius: 0, satelliteShotCooldownMs: 1000000 });
  Object.assign(elite, { x: satellite.state.player.x, y: satellite.state.player.y });
  satellite.scene.update(16);
  near(1000000 - elite.hp, 1500 * 0.016 * 0.8 * 1.2 * 1.35, "satellite wind and hunter amplification");

  const bomb = battle();
  apply(bomb, "grass_tailwind", "grass_gale");
  forceWind(bomb, true);
  const boss = target(bomb, "boss"), armored = target(bomb, "elite"), normal = target(bomb);
  bomb.state.enemies = [boss, armored, normal];
  bomb.state.enemyBullets = [{ x: 20, y: 20 }];
  bomb.hooks.triggerBomb();
  assert.equal(boss.hp, 1000000 - 25000 * 1.35);
  near(armored.hp, 1000000 * (1 - 0.5 * 1.35), "elite bomb damage");
  assert.ok(!bomb.state.enemies.includes(normal));
  assert.equal(bomb.state.enemyBullets.length, 0);

  const reflected = battle();
  apply(reflected, "thorn_static", "grass_tailwind", "grass_gale", "grass_roots");
  forceWind(reflected, true);
  const contact = target(reflected);
  Object.assign(contact, { x: reflected.state.player.x, y: reflected.state.player.y });
  reflected.scene.update(16);
  assert.equal(1000000 - contact.hp, 2000 * 1.35, "contact reflection receives the all-damage bonus");
});

test("full-health Antler King victories settle 1200 coins once and unlock windrunner without tidecaller or hidden Void", () => {
  for (const finisher of ["primary", "satellite", "bomb"]) {
    const env = battle("grassland", { startWave: 3 });
    const boss = env.state.enemies.find((enemy) => enemy.isBoss);
    assert.equal(boss.bossVariant, "antlerKing");
    Object.assign(boss, { entered: true, x: 100, y: 100, currentAttack: null,
      attackTimer: 1000000, grassState: "idle", grassTimer: 1000000, hp: 1 });
    if (finisher === "primary") hitWithMainBullet(env, boss);
    else if (finisher === "bomb") env.hooks.triggerBomb();
    else {
      apply(env, "sat_orbit");
      Object.assign(env.state, { satelliteCount: 1, satelliteOrbitRadius: 0, satelliteShotCooldownMs: 1000000 });
      Object.assign(boss, { x: env.state.player.x, y: env.state.player.y });
      env.scene.update(16);
    }
    assert.equal(env.state.hp, env.state.maxHp, `${finisher} preserves full health`);
    assert.equal(env.state.win, true, `${finisher} wins directly`);
    assert.equal(env.state.gameOver, true);
    assert.equal(env.state.hiddenVoidConsumed, false);
    assert.equal(env.state.offerEndlessAfterVoidWin, false);
    assert.ok(!env.state.enemies.some((enemy) => enemy.isBoss));
    const saved = env.load("src/storage.js").get();
    assert.equal(saved.coins, 1200, `${finisher} reward`);
    assert.equal(saved.unlockedCharacters.windrunner, true);
    assert.equal(saved.unlockedCharacters.tidecaller, false, "grassland cannot grant the ocean character");
    const writes = env.writes.length;
    env.scene.update(1000);
    assert.equal(saved.coins, 1200);
    assert.equal(env.writes.length, writes, "post-victory updates cannot settle or unlock twice");
  }
});
