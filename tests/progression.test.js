"use strict";

// Ocean → grassland + Tidecaller; grassland → Windrunner.
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
    if (filename === path.join(ROOT, "src", "menu.js")) {
      source = source.replace(/return \{\s*update,\s*draw,/, "return { __test: { state, handleCharacterTap, handleMapTap, getMapRect, getStartRect, getVisibleCharacterIndices }, update, draw,");
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

test("新存档只看得见星空：没解锁的地图和角色一律不展示", () => {
  for (const raw of [undefined, { coins: 98765, selectedMapId: "grassland", selectedCharacterId: "windrunner" }]) {
    const env = harness(raw), storage = env.load("src/storage.js"), save = storage.get();
    const maps = env.load("src/maps.js"), chars = env.load("src/characters.js");
    assert.equal(save.unlockedMaps.ocean, false);
    assert.equal(save.unlockedMaps.grassland, false);
    assert.equal(save.unlockedCharacters.tidecaller, false);
    assert.equal(save.unlockedCharacters.windrunner, false);
    assert.equal(maps.resolveSelectedMap(save).id, "starfield");

    // 未解锁的地图一张都不列出来——不留占位、不剧透
    // 数组是在 vm 上下文里造的，与宿主 realm 原型不同，deepEqual 会判不等——比字符串
    assert.equal(maps.getVisibleMaps(save).map((m) => m.id).join(","), "starfield");

    for (const id of ["tidecaller", "windrunner"]) {
      assert.equal(chars.isCharacterUnlocked(save, chars.CHARACTERS.find((c) => c.id === id)), false);
    }
    if (raw) assert.equal(save.coins, raw.coins);
  }
});

test("通关地图才解锁角色的那两位，未解锁前不出现在角色栏；金币角色照常展示", () => {
  const env = harness({ coins: 100000 });
  const storage = env.load("src/storage.js");
  const chars = env.load("src/characters.js").CHARACTERS;
  const menu = env.load("src/menu.js").createMenuScene({ onStart() {} });
  const visible = () => menu.__test.getVisibleCharacterIndices(storage.get()).map((i) => chars[i].id);

  const before = visible();
  assert.ok(!before.includes("tidecaller"), "潮汐使未解锁时不该展示");
  assert.ok(!before.includes("windrunner"), "逐风者未解锁时不该展示");
  // 兑换码角色同样不展示
  chars.filter((c) => c.unlockByCodeOnly).forEach((c) => {
    assert.ok(!before.includes(c.id), `${c.id} 未解锁时不该展示`);
  });
  // 金币角色是例外：要留在列表里才买得到
  const paid = chars.filter((c) => c.unlockCost > 0);
  assert.ok(paid.length > 0);
  paid.forEach((c) => assert.ok(before.includes(c.id), `${c.id} 是金币角色，必须可见才买得到`));

  storage.recordMapClear("ocean");
  assert.ok(visible().includes("tidecaller"), "通关海洋后潮汐使才出现");
  assert.ok(!visible().includes("windrunner"));
  storage.recordMapClear("grassland");
  assert.ok(visible().includes("windrunner"), "通关草原后逐风者才出现");
});

test("clear rewards persist atomically, repair recorded progress on load, repeat safely and reset", () => {
  const env = harness(), storage = env.load("src/storage.js");
  storage.recordMapClear("starfield");
  assert.equal(storage.get().unlockedMaps.grassland, false);
  const rewards = storage.recordMapClear("ocean");
  assert.equal(rewards.maps[0].id, "grassland");
  assert.equal(rewards.characters[0].id, "tidecaller");
  assert.equal(storage.get().unlockedCharacters.windrunner, false);
  const written = env.writes.at(-1).value;
  assert.equal(written.completedMaps.ocean, true);
  assert.equal(written.unlockedMaps.grassland, true);
  assert.equal(written.unlockedCharacters.tidecaller, true);
  assert.equal(storage.recordMapClear("ocean").characters.length, 0);
  const reloaded = harness(written).load("src/storage.js");
  assert.equal(reloaded.get().unlockedCharacters.tidecaller, true);
  assert.equal(reloaded.recordMapClear("grassland").characters[0].id, "windrunner");
  reloaded.reset();
  assert.equal(reloaded.get().unlockedMaps.grassland, false);
  assert.equal(reloaded.get().unlockedCharacters.tidecaller, false);
  assert.equal(reloaded.get().unlockedCharacters.windrunner, false);
  assert.equal(Object.keys(reloaded.get().completedMaps).length, 0);
  const repaired = harness({ completedMaps: { ocean: true }, coins: 72 }).load("src/storage.js").get();
  assert.equal(repaired.unlockedMaps.grassland, true);
  assert.equal(repaired.unlockedCharacters.tidecaller, true);
  assert.equal(repaired.unlockedCharacters.windrunner, false);
  assert.equal(repaired.coins, 72);
});

test("locked cards cannot be bought for zero coins or selected, then work after the right clear", () => {
  const env = harness({ coins: 100000 }), storage = env.load("src/storage.js"), starts = [];
  const menu = env.load("src/menu.js").createMenuScene({ onStart: (c) => starts.push(c.id) });
  const chars = env.load("src/characters.js").CHARACTERS;
  const tideIndex = chars.findIndex((c) => c.id === "tidecaller"), windIndex = chars.findIndex((c) => c.id === "windrunner");
  for (const index of [tideIndex, windIndex]) {
    menu.__test.handleCharacterTap(index);
    assert.notEqual(menu.__test.state.selectedIndex, index);
    menu.__test.state.selectedIndex = index;
    const start = menu.__test.getStartRect();
    menu.onTouchStart({ x: start.x + 10, y: start.y + 10 });
    assert.equal(starts.length, 0);
    menu.__test.state.selectedIndex = 0;
  }
  assert.equal(storage.get().coins, 100000);

  // 未解锁的地图现在**根本不在列表里**，所以"点了也选不中"变成"压根点不到"
  const mapsMod = env.load("src/maps.js");
  const listed = () => mapsMod.getVisibleMaps(storage.get()).map((m) => m.id);
  assert.ok(!listed().includes("grassland"), "没通关海洋时草原不该出现在列表里");

  storage.recordMapClear("ocean");
  // 通关海洋后草原才出现，且此时点它能选中
  const after = mapsMod.getVisibleMaps(storage.get());
  const grassIndex = after.findIndex((m) => m.id === "grassland");
  assert.ok(grassIndex >= 0, "通关海洋后草原应当出现");
  const r = menu.__test.getMapRect(grassIndex);
  menu.__test.handleCharacterTap(tideIndex);
  assert.equal(menu.__test.state.selectedIndex, tideIndex);
  menu.__test.handleMapTap(r.x + 5, r.y + 5);
  assert.equal(menu.__test.state.selectedMapId, "grassland");
  menu.__test.handleCharacterTap(windIndex);
  assert.equal(menu.__test.state.selectedIndex, tideIndex);
  storage.recordMapClear("grassland");
  menu.__test.handleCharacterTap(windIndex);
  assert.equal(menu.__test.state.selectedIndex, windIndex);
  assert.equal(storage.get().coins, 100000);
});

for (const finisher of ["primary", "satellite", "bomb", "reflection"]) {
  test(`ocean victory by ${finisher} unlocks grassland and Tidecaller even below full health`, () => {
    const env = battle("ocean", { startWave: 3 });
    const boss = env.state.enemies.find((e) => e.isBoss);
    Object.assign(boss, { entered: true, x: 100, y: 100, currentAttack: null, attackTimer: 1000000, hp: 1 });
    env.state.hp = env.state.maxHp * 0.6;
    if (finisher === "primary") hitWithMainBullet(env, boss);
    else if (finisher === "bomb") env.hooks.triggerBomb();
    else {
      if (finisher === "satellite") {
        env.state.satelliteCount = 1; env.state.satelliteDamagePerSec = 1500;
        env.state.satelliteOrbitRadius = 0; env.state.satelliteShotCooldownMs = 1000000;
      } else env.state.thornReflectRate = 1;
      boss.x = env.state.player.x; boss.y = env.state.player.y;
      env.scene.update(16);
    }
    assert.equal(env.state.win, true);
    const storage = env.load("src/storage.js"), save = storage.get();
    assert.equal(save.completedMaps.ocean, true);
    assert.equal(save.unlockedMaps.grassland, true);
    assert.equal(save.unlockedCharacters.tidecaller, true);
    assert.equal(save.unlockedCharacters.windrunner, false);
    assert.equal(env.state.newMapUnlockedName, "草原");
    assert.equal(env.state.newCharacterUnlockedName, "潮汐使");
    const coins = save.coins;
    env.scene.update(1000);
    assert.equal(save.coins, coins);
  });
}

test("losing ocean or defeating a forced wrong boss grants no ocean rewards", () => {
  const env = battle("ocean");
  env.state.godMode = false;
  env.state.hp = 1;
  const p = env.state.player;
  env.state.enemyBullets.push({ x: p.x, y: p.y, w: p.w, h: p.h, vx: 0, vy: 0, dmg: 100 });
  env.scene.update(16);
  assert.equal(env.state.gameOver, true);
  assert.equal(env.state.win, false);
  assert.equal(env.load("src/storage.js").get().unlockedMaps.grassland, false);
  const wrong = battle("ocean", { startWave: 3 });
  const boss = wrong.state.enemies.find((e) => e.isBoss);
  boss.bossVariant = "hanba"; boss.hp = 1;
  wrong.hooks.triggerBomb();
  assert.equal(wrong.load("src/storage.js").get().unlockedMaps.grassland, false);
});

function characterBattle(id) {
  const env = harness({ selectedMapId: "starfield", musicOn: false });
  const c = env.load("src/characters.js").CHARACTERS.find((item) => item.id === id);
  const scene = env.load("src/battle.js").createBattleScene({ character: c, onExit() {} });
  return { ...env, scene, state: scene.__test.state, hooks: scene.__test };
}

test("Windrunner charges from actual clamped movement and spends exactly one boosted primary volley", () => {
  const env = characterBattle("windrunner"), p = env.state.player;
  env.scene.onTouchStart({ x: p.x, y: p.y });
  env.scene.onTouchMove({ x: p.x, y: p.y });
  assert.equal(env.state.windCharge, 0);
  env.scene.onTouchMove({ x: 1000, y: p.y });
  assert.equal(env.state.windCharge, 180);
  env.state.sideBullets = 1;
  env.hooks.fireBullets();
  assert.equal(env.state.bullets.length, 3);
  assert.ok(env.state.bullets.every((b) => b.pierceEnemies && b.windVolley && b.dmg === 880 * 1.8));
  assert.equal(env.state.windCharge, 0);
  env.state.bullets = [];
  env.hooks.fireBullets();
  assert.ok(env.state.bullets.every((b) => !b.windVolley && !b.pierceEnemies && b.dmg === 880));
  env.state.pausedForUpgrade = true;
  env.scene.onTouchMove({ x: 0, y: 400 });
  assert.equal(env.state.windCharge, 0);
  const striker = characterBattle("striker");
  striker.scene.onTouchStart({ x: 200, y: 700 }); striker.scene.onTouchMove({ x: 0, y: 400 });
  assert.equal(striker.state.windCharge, 0);
});

test("Tidecaller starts with a 20% shield and fires two real homing tidal bolts every fourth volley", () => {
  const env = characterBattle("tidecaller");
  assert.equal(env.state.shieldMaxHp, env.state.maxHp * 0.2);
  assert.equal(env.state.shieldHp, env.state.shieldMaxHp);
  const target = env.load("src/enemies.js").createGrunt(1);
  target.x = 60; target.y = 140; env.state.enemies = [target];
  for (let n = 1; n <= 8; n++) {
    env.state.bullets = []; env.hooks.fireBullets();
    const tidal = env.state.bullets.filter((b) => b.tidecallerBolt);
    assert.equal(tidal.length, n % 4 === 0 ? 2 : 0);
    tidal.forEach((b) => {
      assert.equal(b.homingTargetRef, target);
      assert.equal(b.homing, true);
      assert.equal(b.dmg, 840 * 1.4);
    });
  }
  const bolt = env.state.bullets.find((b) => b.tidecallerBolt), vx = bolt.vx;
  env.state.godMode = true; env.state.spawnTimer = -10000;
  env.scene.update(16);
  assert.notEqual(bolt.vx, vx);
  assert.ok([bolt.x, bolt.y, bolt.vx, bolt.vy].every(Number.isFinite));
});

