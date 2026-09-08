"use strict";

// Run from the project root: node --test tests/ocean.test.js
// Real CommonJS modules run in an isolated WeChat-like VM. The only source
// instrumentation exposes battle closures to this test; production exports stay unchanged.
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
  function load(relativeOrAbsolute) {
    let filename = path.resolve(ROOT, relativeOrAbsolute);
    if (!path.extname(filename)) filename += ".js";
    if (cache.has(filename)) return cache.get(filename).exports;
    let source = fs.readFileSync(filename, "utf8");
    if (filename === path.join(ROOT, "src", "battle.js")) {
      const marker = /  return \{\r?\n    update,\r?\n    draw,/g;
      assert.equal((source.match(marker) || []).length, 1, "battle test seam must match exactly once");
      source = source.replace(marker, `  return {
    __test: { state, fireBullets, spawnRegular, spawnWave2Elite, spawnBoss,
      updateMechanics, gainExp, consumeItem, triggerBomb },
    update,
    draw,`);
    }
    const mod = { exports: {} };
    cache.set(filename, mod);
    const wrapped = new vm.Script(`(function(require, module, exports) {\n${source}\n})`, { filename });
    wrapped.runInContext(context)((request) => {
      assert.ok(request.startsWith("."), `unexpected runtime dependency: ${request}`);
      return load(path.resolve(path.dirname(filename), request));
    }, mod, mod.exports);
    return mod.exports;
  }
  return { load, writes, math };
}

function battle(mapId = "ocean", debug, saveExtras) {
  // 海洋起就要通关前一张图才解锁；这些用例测的是玩法不是解锁流程，夹具直接给通
  const env = harness({
    selectedMapId: mapId, musicOn: false,
    ...saveExtras,
    unlockedMaps: { ocean: true, ...(saveExtras || {}).unlockedMaps },
  });
  const { CHARACTERS } = env.load("src/characters.js");
  const scene = env.load("src/battle.js").createBattleScene({
    character: CHARACTERS[0], onExit() {}, debug,
  });
  const state = scene.__test.state;
  state.godMode = true;
  state.spawnTimer = -1000000;
  state.shootInterval = 1000000000;
  state.expToNext = 1000000000;
  return { ...env, scene, state, hooks: scene.__test };
}

function apply(env, ...ids) {
  const pool = env.load("src/upgrades.js").UPGRADE_POOL;
  ids.forEach((id) => {
    const upgrade = pool.find((u) => u.id === id);
    assert.ok(upgrade, `upgrade ${id} must exist`);
    assert.ok(upgrade.available(env.state), `upgrade ${id} must be available`);
    upgrade.apply(env.state);
  });
}

function forceTide(env, active) {
  env.state.devMechanics.tide = active ? "on" : "off";
  env.hooks.updateMechanics(0);
}

function target(env, kind = "normal") {
  const enemies = env.load("src/enemies.js");
  const enemy = kind === "boss" ? enemies.createBoss("leviathan", 1)
    : kind === "elite" ? enemies.createAbyssalAngler(1) : enemies.createReefRay(1);
  Object.assign(enemy, {
    x: 100, y: 100, speed: 0, vx: 0, hp: 1000000, maxHp: 1000000,
    damageTakenMul: 1, fireCooldown: 1000000, entered: true,
    currentAttack: null, attackTimer: 1000000,
  });
  env.state.enemies = [enemy];
  return enemy;
}

function hitWithMainBullet(env, enemy) {
  env.hooks.fireBullets();
  const bullet = env.state.bullets[0];
  Object.assign(bullet, { x: enemy.x - 5, y: enemy.y - 5, w: enemy.w + 20, h: enemy.h + 20, vx: 0, vy: 0 });
  const before = enemy.hp;
  env.scene.update(16);
  return before - enemy.hp;
}

test("ocean registry references real content and each weighted spawn slot resolves to its own factory", () => {
  const env = harness();
  const maps = env.load("src/maps.js");
  const enemies = env.load("src/enemies.js");
  const mechanics = env.load("src/mechanics.js");
  assert.equal(maps.validateMaps({
    enemyPools: enemies.ENEMY_POOLS, eliteFactories: enemies.ELITE_FACTORIES,
    bossVariants: enemies.BOSS_VARIANTS, mechanics: mechanics.MECHANICS,
  }).length, 0);
  const ocean = maps.getMapById("ocean");
  assert.equal(ocean.particle, "ocean");
  assert.equal(ocean.bossVariant, "leviathan");
  assert.equal(maps.pickMapBossVariant(ocean), "leviathan");
  assert.equal(enemies.bossLeadsToHidden("leviathan"), false);
  assert.ok(enemies.forceableBossIds().includes("leviathan"));
  assert.equal(enemies.ENEMY_POOLS.ocean.length, 5);
  for (const wave of [1, 2, 3]) {
    const slots = enemies.ENEMY_POOLS.ocean.filter((slot) => slot.minWave <= wave);
    const total = slots.reduce((sum, slot) => sum + slot.weight, 0);
    let cumulative = 0;
    for (const slot of slots) {
      env.math.random = () => (cumulative + slot.weight / 2) / total;
      const enemy = enemies.spawnEnemyForWave(wave, 8, ocean.enemyPool);
      assert.equal(enemy.type, slot.type, `wave ${wave}, slot ${slot.type}`);
      assert.equal(enemy.isOcean, true);
      assert.ok(enemy.hp > 0 && enemy.hp === enemy.maxHp);
      assert.ok([enemy.x, enemy.y, enemy.w, enemy.h].every(Number.isFinite));
      cumulative += slot.weight;
    }
  }
  const elite = enemies.createEliteFor(ocean.eliteType, 8);
  assert.equal(elite.type, "abyssalAngler");
  assert.equal(elite.isElite, true);
});

test("旧存档保留进度；海洋要通关星空才解锁，未解锁前既不展示也进不去", () => {
  const env = harness({ coins: 437, bestKills: 91, talents: { vitality: 2 }, unlockedMaps: { desert: true } });
  const storage = env.load("src/storage.js");
  const maps = env.load("src/maps.js");
  const save = storage.get();
  assert.equal(save.coins, 437);
  assert.equal(save.bestKills, 91);
  assert.equal(save.talents.vitality, 2);
  assert.equal(save.unlockedMaps.desert, true);

  // 新存档：只有星空。未解锁的地图**一张都不列出来**
  assert.equal(save.unlockedMaps.ocean, false, "海洋不该默认解锁");
  // 数组是在 vm 上下文里造的，与宿主 realm 原型不同，deepEqual 会判不等——比字符串
  assert.equal(maps.getVisibleMaps(save).map((m) => m.id).sort().join(","), "desert,starfield");
  assert.equal(maps.resolveSelectedMap(save).id, "starfield");
  storage.setSelectedMapId("ocean");
  assert.equal(maps.resolveSelectedMap(storage.get()).id, "starfield", "没解锁就选不进去");

  // 通关星空之后才拿到海洋
  const rewards = storage.recordMapClear("starfield");
  assert.ok(rewards.maps.some((m) => m.id === "ocean"), "通关星空应解锁海洋");
  assert.equal(storage.get().unlockedMaps.ocean, true);
  assert.ok(maps.getVisibleMaps(storage.get()).some((m) => m.id === "ocean"));
  storage.setSelectedMapId("ocean");
  assert.equal(maps.resolveSelectedMap(storage.get()).id, "ocean");
  assert.equal(env.writes.at(-1).value.coins, 437, "解锁不该动金币");

  assert.equal(maps.resolveSelectedMap({ selectedMapId: "missing" }).id, "starfield");
  assert.equal(maps.resolveSelectedMap({ selectedMapId: "desert" }).id, "starfield");
  const fresh = harness().load("src/storage.js").get();
  assert.equal(fresh.unlockedMaps.ocean, false);
  assert.equal(fresh.selectedMapId, "starfield");
  assert.equal(battle("ocean").state.mapId, "ocean");
  assert.equal(battle("missing").state.mapId, "starfield");
});

test("eight ocean hexes remain map-exclusive, honor prerequisites and compose independent of pick order", () => {
  const env = battle();
  const oldEliteMul = env.state.eliteDmgMul;
  const oldBossMul = env.state.bossDmgMul;
  const pool = env.load("src/upgrades.js").UPGRADE_POOL;
  const ocean = pool.filter((u) => u.maps && u.maps.includes("ocean"));
  assert.equal(ocean.length, 8);
  for (const rarity of ["green", "blue", "purple", "orange"]) {
    assert.equal(ocean.filter((u) => u.rarity === rarity).length, 2);
  }
  for (const mapId of ["starfield", "desert"]) {
    assert.ok(ocean.every((u) => !u.available({ mapId })));
  }
  assert.equal(ocean.find((u) => u.id === "ocean_storm_surge").available(env.state), false);
  apply(env, "ocean_rapid", "ocean_storm_surge", "ocean_coral", "ocean_stable_fin",
    "ocean_scavenger", "ocean_ebb_mend", "ocean_hunter", "ocean_heart");
  assert.ok(ocean.every((u) => !u.available(env.state)));
  assert.equal(env.state.tideDamageMul, 2);
  assert.equal(env.state.tideEnemyBulletSpeedMul, 1.25);
  assert.equal(env.state.tideDriftMul, 0);
  assert.equal(env.state.bulletSpeedMul, 1.15);
  assert.equal(env.state.eliteDmgMul, oldEliteMul * 1.25);
  assert.equal(env.state.bossDmgMul, oldBossMul * 1.25);
  const reversed = battle();
  apply(reversed, "ocean_coral", "ocean_rapid", "ocean_storm_surge");
  assert.equal(reversed.state.tideDamageMul, env.state.tideDamageMul);
});

test("starfield and an unlocked desert still initialize their own mechanics, enemies and Boss variants", () => {
  const star = battle("starfield", { startWave: 3 });
  assert.equal(star.state.mapId, "starfield");
  assert.equal(star.state.mapEnemyPool, "starfield");
  assert.equal(star.state.tideCfg, null);
  assert.equal(star.state.sandstormCfg, null);
  assert.ok(["crimson", "azure"].includes(star.state.enemies.find((e) => e.isBoss).bossVariant));
  star.hooks.updateMechanics(16200);
  assert.equal(star.state.tideActive, false);
  const desert = battle("desert", undefined, { unlockedMaps: { desert: true } });
  assert.equal(desert.state.mapId, "desert");
  assert.equal(desert.state.mapEliteType, "sandworm");
  assert.equal(desert.state.tideCfg, null);
  assert.ok(desert.state.sandstormCfg);
  desert.hooks.updateMechanics(22000);
  assert.equal(desert.state.sandstormPhase, "warn");
  desert.hooks.updateMechanics(2000);
  assert.equal(desert.state.sandstormActive, true);
  assert.equal(desert.state.tideActive, false);
  desert.hooks.spawnBoss();
  assert.equal(desert.state.enemies.find((e) => e.isBoss).bossVariant, "hanba");
});

test("tide cycles retain elapsed remainder, alternate direction and continue through Boss mechanics suspension", () => {
  const env = harness();
  const { getMechanic, mechanicDefaults } = env.load("src/mechanics.js");
  const tide = getMechanic("tide");
  const state = Object.assign({ elapsed: 0, mechanicsSuspended: true }, mechanicDefaults());
  const cfg = env.load("src/maps.js").getMapById("ocean").mechanics.tide;
  tide.update(state, 13999, cfg);
  assert.equal(state.tidePhase, "calm");
  tide.update(state, 1, cfg);
  assert.equal(state.tidePhase, "warn");
  assert.equal(state.tideDirection, 1);
  tide.update(state, 2200, cfg);
  assert.equal(state.tideActive, true);
  tide.update(state, 8000, cfg);
  assert.equal(state.tideActive, false);
  assert.equal(state.tideDirection, -1);
  tide.update(state, 16250, cfg);
  assert.equal(state.tideActive, true);
  assert.equal(state.tideTimerMs, 50);
  assert.equal(tide.applyDev(state, "off", cfg), true);
  assert.equal(state.tideActive, false);
  assert.equal(state.tideTimerMs, 0);
  assert.equal(tide.applyDev(state, "on", cfg), true);
  assert.equal(state.tideActive, true);
  assert.equal(tide.applyDev(state, "auto", cfg), false);
});

test("battle applies tide start clear/shield and ebb healing once per boundary, including Boss battles", () => {
  const env = battle();
  const { state, hooks } = env;
  apply(env, "ocean_heart", "ocean_ebb_mend");
  state.hp = 1500;
  state.bossActive = state.wave3BossSpawned = true;
  state.tidePhase = "warn";
  state.tideTimerMs = 2190;
  state.enemyBullets = [{ x: 20, y: 20, vx: 0, vy: 1 }];
  hooks.updateMechanics(10);
  assert.equal(state.mechanicsSuspended, true);
  assert.equal(state.tideActive, true);
  assert.equal(state.enemyBullets.length, 0);
  assert.equal(state.shieldHp, 600);
  state.shieldHp = 200;
  state.enemyBullets.push({ x: 20, y: 20 });
  hooks.updateMechanics(1);
  assert.equal(state.shieldHp, 200, "shield must not replenish every active frame");
  assert.equal(state.enemyBullets.length, 1, "clear must only happen at rising edge");
  state.tideTimerMs = 7999;
  hooks.updateMechanics(1);
  assert.equal(state.tideActive, false);
  assert.equal(state.hp, 1680);
  hooks.updateMechanics(1);
  assert.equal(state.hp, 1680, "ebb heal must happen exactly once");
  state.maxHp = 4000;
  state.tidePhase = "warn";
  state.tideTimerMs = 2199;
  hooks.updateMechanics(1);
  assert.equal(state.shieldMaxHp, 800, "shield capacity follows max HP growth");
  assert.equal(state.shieldHp, 800, "shield refill is capped to available capacity");
});

test("tide drifts the player and drag anchor, respects screen bounds, and Stable Fin prevents drift", () => {
  const env = battle();
  forceTide(env, true);
  const { state, hooks } = env;
  state.player.x = 100;
  state.touchActive = true;
  state.touchOffsetX = 30;
  hooks.updateMechanics(1000);
  assert.equal(state.player.x, 124);
  assert.equal(state.touchOffsetX, 6);
  state.tideDirection = -1;
  hooks.updateMechanics(1000);
  assert.equal(state.player.x, 100);
  state.player.x = 2;
  hooks.updateMechanics(1000);
  assert.equal(state.player.x, 0);
  apply(env, "ocean_stable_fin");
  state.player.x = 100;
  hooks.updateMechanics(1000);
  assert.equal(state.player.x, 100);
  env.hooks.fireBullets();
  assert.equal(state.bullets[0].vy, -8.5 * 1.15);
});

test("upgrade selection freezes tide phase, enemy motion, player drift and elapsed battle time", () => {
  const env = battle();
  forceTide(env, true);
  const enemy = target(env);
  const { state } = env;
  state.expToNext = 5;
  env.hooks.gainExp(5);
  assert.equal(state.pausedForUpgrade, true);
  const before = [state.elapsed, state.tideTimerMs, state.player.x, enemy.x, enemy.y];
  env.scene.update(1000);
  assert.deepEqual([state.elapsed, state.tideTimerMs, state.player.x, enemy.x, enemy.y], before);
  assert.equal(state.upgradeOptions.length, 3);
});

test("experience applies map tide and scavenger multipliers at collection, without leaking to calm or other maps", () => {
  const env = battle();
  env.state.expMul = 2;
  env.state.expOrbValueMul = 2;
  apply(env, "ocean_scavenger");
  env.hooks.consumeItem({ type: "exp_medium", expValue: 10 });
  assert.equal(env.state.exp, 40);
  forceTide(env, true);
  env.hooks.consumeItem({ type: "exp_medium", expValue: 10 });
  assert.equal(env.state.exp, 40 + 72);
  forceTide(env, false);
  env.hooks.consumeItem({ type: "exp_medium", expValue: 10 });
  assert.equal(env.state.exp, 40 + 72 + 40);
  const star = battle("starfield");
  star.hooks.consumeItem({ type: "exp_medium", expValue: 10 });
  assert.equal(star.state.exp, 10);
  assert.equal(star.state.tideCfg, null);
});

test("tide rapid fire and Storm Surge enemy-bullet speed are temporary active-phase effects", () => {
  const env = battle();
  apply(env, "ocean_rapid", "ocean_storm_surge");
  env.state.shootInterval = 1300;
  env.scene.update(1000);
  assert.equal(env.state.bullets.length, 0);
  env.state.shootTimer = 0;
  forceTide(env, true);
  env.state.enemyBullets = [{ x: 20, y: 20, w: 6, h: 6, vx: 4, vy: 2, dmg: 1 }];
  env.scene.update(1000);
  assert.equal(env.state.bullets.length, 1);
  assert.equal(env.state.enemyBullets[0].x, 25);
  assert.equal(env.state.enemyBullets[0].y, 22.5);
  forceTide(env, false);
  env.scene.update(16);
  assert.equal(env.state.enemyBullets[0].x, 29);
  assert.equal(env.state.enemyBullets[0].y, 24.5);
});

for (const kind of ["normal", "elite", "boss"]) {
  test(`primary bullet tide damage reaches ${kind} targets and Deep Sea Hunter applies to its target classes`, () => {
    const env = battle();
    apply(env, "ocean_coral", "ocean_rapid", "ocean_storm_surge", "ocean_hunter");
    const enemy = target(env, kind);
    // Existing combat applies 0.8 elite / 0.65 Boss resistance before upgrades;
    // Boss hits round down to an integer before the tide multiplier is applied.
    const calmDamage = kind === "boss" ? 812 : 1000;
    assert.equal(hitWithMainBullet(env, enemy), calmDamage);
    forceTide(env, true);
    assert.equal(hitWithMainBullet(env, enemy), calmDamage * 2);
    forceTide(env, false);
    assert.equal(hitWithMainBullet(env, enemy), calmDamage);
  });
}

test("satellite contact damage receives tide amplification and elite hunter bonus", () => {
  const env = battle();
  apply(env, "sat_orbit", "ocean_coral", "ocean_hunter", "ocean_stable_fin");
  forceTide(env, true);
  const enemy = target(env, "elite");
  env.state.satelliteCount = 1;
  env.state.satelliteOrbitRadius = 0;
  env.state.satelliteShotCooldownMs = 1000000;
  enemy.x = env.state.player.x;
  enemy.y = env.state.player.y;
  const before = enemy.hp;
  env.scene.update(16);
  assert.equal(before - enemy.hp, 1500 * 0.016 * 1.25 * 0.8 * 1.25);
});

test("bomb tide damage reaches Boss and elite targets, while normal enemies and enemy bullets clear", () => {
  const env = battle();
  apply(env, "ocean_coral");
  forceTide(env, true);
  const boss = target(env, "boss");
  const elite = target(env, "elite");
  const normal = target(env);
  env.state.enemies = [boss, elite, normal];
  env.state.enemyBullets = [{ x: 20, y: 20 }];
  env.hooks.triggerBomb();
  assert.equal(boss.hp, 1000000 - 31250);
  assert.equal(elite.hp, 375000);
  assert.ok(!env.state.enemies.includes(normal));
  assert.equal(env.state.enemyBullets.length, 0);
});

test("all-damage tide hexes also amplify reflection", () => {
  const env = battle();
  apply(env, "thorn_static", "ocean_coral", "ocean_stable_fin");
  forceTide(env, true);
  const enemy = target(env);
  enemy.x = env.state.player.x;
  enemy.y = env.state.player.y;
  const before = enemy.hp;
  env.scene.update(16);
  assert.equal(before - enemy.hp, 2000 * 1.25);
});

test("live Leviathan AI telegraphs all three attacks, preserves the tide-gate corridor and changes phase at half health", () => {
  const env = battle("ocean", { startWave: 3 });
  const { state, scene } = env;
  const boss = state.enemies.find((enemy) => enemy.isBoss);
  const attacks = new Set();
  let sawWarning = false;
  let sawDamageWindow = false;
  let sawTide = false;
  let gateShots = 0;
  for (let frame = 0; frame < 2800; frame += 1) {
    scene.update(16);
    if (boss.leviathanAttack) attacks.add(boss.leviathanAttack);
    if (boss.leviathanState === "warn") {
      sawWarning = true;
      assert.ok(boss.leviathanWarnMs >= 900);
      assert.ok(boss.leviathanWarnProgress >= 0 && boss.leviathanWarnProgress <= 1);
    }
    if (boss.damageTakenMul > 1) sawDamageWindow = true;
    if (state.tideActive) sawTide = true;
    for (const bullet of state.enemyBullets) {
      assert.ok([bullet.x, bullet.y, bullet.vx, bullet.vy].every(Number.isFinite));
      if (!bullet.leviathanGate) continue;
      gateShots += 1;
      const gapLeft = boss.leviathanGapX - boss.leviathanGapW / 2;
      const gapRight = boss.leviathanGapX + boss.leviathanGapW / 2;
      assert.ok(bullet.x + bullet.w < gapLeft || bullet.x > gapRight,
        "tide-gate bullets must not overlap the displayed safe corridor");
    }
  }
  assert.equal(boss.entered, true);
  assert.deepEqual([...attacks].sort(), ["abyssFan", "breach", "tideGate"]);
  assert.ok(sawWarning && sawDamageWindow && sawTide && gateShots > 0);
  assert.equal(boss.leviathanPhase, 1);
  state.enemyBullets = [
    { x: 20, y: 20, w: 6, h: 6, vx: 0, vy: 0, leviathanBullet: true },
    { x: 30, y: 20, w: 6, h: 6, vx: 0, vy: 0, oceanBullet: true },
  ];
  boss.hp = boss.maxHp * 0.5;
  scene.update(16);
  assert.equal(boss.leviathanPhase, 2);
  assert.equal(boss.leviathanState, "transition");
  assert.equal(boss.currentAttack, null);
  assert.ok(!state.enemyBullets.some((b) => b.leviathanBullet));
  assert.ok(state.enemyBullets.some((b) => b.oceanBullet), "transition preserves non-Boss bullets");
  assert.equal(state.gameOver, false);
  for (let frame = 0; frame < 200; frame += 1) scene.update(16);
  assert.equal(boss.leviathanPhase, 2);
  assert.notEqual(boss.leviathanState, "transition");
  assert.ok([boss.x, boss.y].every(Number.isFinite));
});

for (const finisher of ["primary", "satellite", "bomb"]) {
  test(`full-health ocean Boss defeat by ${finisher} settles a direct victory without spawning hidden Void`, () => {
    const env = battle("ocean", { startWave: 3 });
    const boss = env.state.enemies.find((enemy) => enemy.isBoss);
    assert.equal(boss.bossVariant, "leviathan");
    Object.assign(boss, { entered: true, x: 100, y: 100, currentAttack: null, attackTimer: 1000000, hp: 1 });
    if (finisher === "primary") hitWithMainBullet(env, boss);
    else if (finisher === "bomb") env.hooks.triggerBomb();
    else {
      apply(env, "sat_orbit");
      env.state.satelliteCount = 1;
      env.state.satelliteOrbitRadius = 0;
      env.state.satelliteShotCooldownMs = 1000000;
      boss.x = env.state.player.x;
      boss.y = env.state.player.y;
      env.scene.update(16);
    }
    assert.equal(env.state.hp, env.state.maxHp);
    assert.equal(env.state.win, true);
    assert.equal(env.state.gameOver, true);
    assert.equal(env.state.hiddenVoidConsumed, false);
    assert.equal(env.state.offerEndlessAfterVoidWin, false);
    assert.ok(!env.state.enemies.some((enemy) => enemy.isBoss));
    const savedCoins = env.load("src/storage.js").get().coins;
    assert.equal(savedCoins, 1000);
    env.scene.update(1000);
    assert.equal(env.load("src/storage.js").get().coins, savedCoins, "victory must settle only once");
  });
}
