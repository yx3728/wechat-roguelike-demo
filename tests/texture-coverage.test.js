"use strict";

// node --test tests/texture-coverage.test.js
// Tests actual registries, PNG dimensions, renderer adapters and battle draw paths.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");

function runtime(options = {}) {
  const createdImages = [];
  const requests = [];
  const cache = new Map();
  const wx = {
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }),
    getStorageSync: () => ({ musicOn: false, battleTexturesOn: options.enabled === true }),
    setStorageSync() {},
    createImage() {
      const image = { naturalWidth: 0, naturalHeight: 0 };
      Object.defineProperty(image, "src", {
        set(value) {
          requests.push(value);
          image.assetPath = value;
          if (options.pending) return;
          if (options.fail) { if (image.onerror) image.onerror(new Error("simulated load failure")); return; }
          const png = fs.readFileSync(path.resolve(ROOT, value));
          assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", `asset must be PNG: ${value}`);
          image.naturalWidth = image.width = png.readUInt32BE(16);
          image.naturalHeight = image.height = png.readUInt32BE(20);
          if (image.onload) image.onload();
        },
      });
      createdImages.push(image);
      return image;
    },
  };
  const context = vm.createContext({ wx, console });
  function load(request) {
    let filename = path.resolve(ROOT, request);
    if (!path.extname(filename)) filename += ".js";
    if (cache.has(filename)) return cache.get(filename).exports;
    let source = fs.readFileSync(filename, "utf8");
    if (filename === path.join(ROOT, "src", "battle.js")) {
      const marker = /  return \{\r?\n    update,\r?\n    draw,/g;
      assert.equal((source.match(marker) || []).length, 1, "battle test seam must remain unique");
      source = source.replace(marker, `  return {
    __test: { state, drawPlayer, drawEnemies, drawBullets },
    update,
    draw,`);
    }
    const mod = { exports: {} };
    cache.set(filename, mod);
    const wrapper = new vm.Script(`(function(require,module,exports){\n${source}\n})`, { filename });
    wrapper.runInContext(context)((relative) => {
      assert.ok(relative.startsWith("."), `unexpected runtime dependency: ${relative}`);
      return load(path.resolve(path.dirname(filename), relative));
    }, mod, mod.exports);
    return mod.exports;
  }
  return { load, createdImages, requests };
}

function canvasRecorder() {
  const draws = [];
  const stack = [];
  const errors = [];
  const props = {
    globalAlpha: 0.72,
    save() { stack.push(this.globalAlpha); },
    restore() { assert.ok(stack.length > 0, "restore must match save"); this.globalAlpha = stack.pop(); },
    drawImage(image, ...args) {
      try {
        assert.ok(args.every(Number.isFinite), "image geometry must be finite");
        if (args.length === 8) {
          const [sx, sy, sw, sh, , , dw, dh] = args;
          assert.ok(sx >= 0 && sy >= 0 && sw > 0 && sh > 0 && dw > 0 && dh > 0);
          assert.ok(sx + sw <= image.naturalWidth + 0.01, `crop exceeds image width: ${image.assetPath}`);
          assert.ok(sy + sh <= image.naturalHeight + 0.01, `crop exceeds image height: ${image.assetPath}`);
        } else {
          assert.equal(args.length, 4);
          assert.ok(args[2] > 0 && args[3] > 0);
        }
        draws.push({ assetPath: image.assetPath, args, alpha: this.globalAlpha });
      } catch (error) { errors.push(error.message); throw error; }
    },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: (text) => ({ width: String(text).length * 7 }),
  };
  const ctx = new Proxy(props, { get(target, key) { return key in target ? target[key] : () => {}; } });
  return { ctx, draws, errors, stack };
}

function enemyInventory(env) {
  const enemies = env.load("src/enemies.js");
  const all = [];
  const seen = new Set();
  for (const [poolName, pool] of Object.entries(enemies.ENEMY_POOLS)) {
    for (const slot of pool) {
      if (seen.has(slot.type)) continue;
      seen.add(slot.type);
      const name = "create" + slot.type[0].toUpperCase() + slot.type.slice(1);
      assert.equal(typeof enemies[name], "function", `${poolName}/${slot.type} must expose its real factory`);
      all.push(enemies[name](6));
    }
  }
  Object.keys(enemies.ELITE_FACTORIES).forEach((id) => all.push(enemies.createEliteFor(id, 6)));
  enemies.BOSS_VARIANTS.forEach(({ id }) => all.push(id === "voidCore"
    ? enemies.createVoidCoreBoss(100, 120, 10) : enemies.createBoss(id, 10)));
  all.forEach((enemy) => { enemy.x = 100; enemy.y = 120; });
  assert.equal(all.length, 31);
  const owner = enemies.createBoss("void", 10);
  all.push({ type: "mirror", isMirror: true, ownerBossRef: owner,
    x: 70, y: 90, w: 80, h: 80, hp: 1000, maxHp: 1000,
    mirrorIntroDurMs: 760, mirrorIntroMsRemain: 380, spinAngle: 0 });
  return all;
}

function drawEnemy(env, ctx, enemy, enabled) {
  const state = { elapsed: 4200, flashEffectsOn: false };
  if (env.load("src/grasslandTextures.js").drawGrasslandTexture(ctx, enemy, state, enabled)) return true;
  if (env.load("src/enemyTextures.js").drawEnemyTexture(ctx, enemy, state, enabled)) return true;
  if (env.load("src/grasslandVisuals.js").drawGrasslandEnemy(ctx, enemy, state)) return true;
  return env.load("src/desertVisuals.js").drawDesertEnemyVisual(ctx, enemy, state, enabled);
}

test("all ten registered characters have menu and battle textures using valid PNG crops", () => {
  const env = runtime();
  const { CHARACTERS } = env.load("src/characters.js");
  assert.equal(CHARACTERS.length, 10);
  const adapter = env.load("src/characterVisuals.js");
  assert.deepEqual(Array.from(adapter.CHARACTER_TEXTURE_IDS).sort(), Array.from(CHARACTERS, (c) => c.id).sort());
  const recorder = canvasRecorder();
  for (const character of CHARACTERS) {
    for (const variant of ["menu", "battle", "gallery"]) {
      const before = recorder.draws.length;
      assert.equal(adapter.drawCharacterTexture(recorder.ctx, character.id, 40, 60, 48, 60, true, variant), true, character.id);
      assert.equal(recorder.draws.length, before + 1);
    }
  }
  assert.equal(env.createdImages.length, 5, "six ships share one atlas; four characters have individual sprites");
  assert.equal(recorder.stack.length, 0);
  assert.deepEqual(recorder.errors, []);
});

test("all 31 registered enemies and the Void mirror draw actual textures without changing combat fields", () => {
  const env = runtime();
  const recorder = canvasRecorder();
  for (const enemy of enemyInventory(env)) {
    const before = JSON.stringify(enemy);
    const drawCount = recorder.draws.length;
    assert.equal(drawEnemy(env, recorder.ctx, enemy, true), true, enemy.bossVariant || enemy.type);
    assert.equal(recorder.draws.length, drawCount + 1, `missing texture: ${enemy.bossVariant || enemy.type}`);
    assert.equal(JSON.stringify(enemy), before, "renderer must not modify enemy gameplay fields");
  }
  assert.equal(new Set(env.requests).size, 6, "two existing images plus four map atlases");
  assert.equal(recorder.stack.length, 0);
  assert.equal(recorder.ctx.globalAlpha, 0.72, "renderer must restore inherited fog alpha");
  assert.deepEqual(recorder.errors, []);
});

test("alternate combat forms select distinct atlas regions", () => {
  const env = runtime();
  const enemies = env.load("src/enemies.js");
  const recorder = canvasRecorder();
  function crop(enemy) {
    assert.equal(drawEnemy(env, recorder.ctx, enemy, true), true);
    return recorder.draws.at(-1).args.slice(0, 4).join(",");
  }
  const crab = enemies.createArmoredCrab(6);
  const closed = crop(crab);
  crab.oceanShellOpen = true;
  assert.notEqual(crop(crab), closed);
  const boss = enemies.createBoss("leviathan", 10);
  boss.leviathanPhase = 1;
  const first = crop(boss);
  boss.leviathanPhase = 2;
  assert.notEqual(crop(boss), first);
  const burrower = enemies.createBurrower(6);
  burrower.burrowPhase = "up";
  const up = crop(burrower);
  burrower.burrowPhase = "under";
  assert.notEqual(crop(burrower), up);
  const worm = enemies.createSandworm(6);
  worm.wormPhase = "up";
  const above = crop(worm);
  worm.wormPhase = "under";
  const under = crop(worm);
  assert.notEqual(under, above);
  worm.wormPhase = "telegraph";
  assert.equal(crop(worm), under);
  const deer = enemies.createBoss("antlerKing", 10);
  deer.grassPhase = 1;
  const summer = crop(deer);
  deer.grassPhase = 2;
  assert.notEqual(crop(deer), summer);
});

test("disabled textures never load or draw images across every character and enemy", () => {
  const env = runtime();
  const recorder = canvasRecorder();
  const characters = env.load("src/characters.js").CHARACTERS;
  const adapter = env.load("src/characterVisuals.js");
  characters.forEach((character) => {
    assert.equal(adapter.drawCharacterTexture(recorder.ctx, character.id, 10, 10, 30, 40, false, "battle"), false);
  });
  enemyInventory(env).forEach((enemy) => drawEnemy(env, recorder.ctx, enemy, false));
  assert.equal(env.createdImages.length, 0);
  assert.equal(env.requests.length, 0);
  assert.equal(recorder.draws.length, 0);
  assert.equal(recorder.stack.length, 0);
});

test("unknown, pending and failed textures return control to the existing procedural renderer", () => {
  for (const options of [{ pending: true }, { fail: true }]) {
    const env = runtime(options);
    const recorder = canvasRecorder();
    const character = env.load("src/characterVisuals.js");
    const enemy = env.load("src/enemyTextures.js");
    const grassland = env.load("src/grasslandTextures.js");
    assert.equal(character.drawCharacterTexture(recorder.ctx, "unknown", 0, 0, 30, 40, true), false);
    assert.equal(enemy.drawEnemyTexture(recorder.ctx, { type: "unknown", x: 0, y: 0, w: 20, h: 20 }, {}, true), false);
    assert.equal(grassland.drawGrasslandTexture(recorder.ctx, { type: "unknown", x: 0, y: 0, w: 20, h: 20 }, {}, true), false);
    assert.equal(env.createdImages.length, 0, "unknown ids must not request assets");
    assert.equal(character.drawCharacterTexture(recorder.ctx, "gunner", 0, 0, 30, 40, true), false);
    assert.equal(enemy.drawEnemyTexture(recorder.ctx, { type: "swift", x: 0, y: 0, w: 20, h: 20 }, {}, true), false);
    assert.equal(grassland.drawGrasslandTexture(recorder.ctx, { type: "meadowHare", x: 0, y: 0, w: 20, h: 20 }, {}, true), false);
    assert.equal(recorder.draws.length, 0);
    assert.equal(env.createdImages.length, 3);
  }
});

test("real battle scenes respect the texture toggle for all players, enemies and both satellite styles", () => {
  const env = runtime();
  const { CHARACTERS } = env.load("src/characters.js");
  const { createBattleScene } = env.load("src/battle.js");
  const storage = env.load("src/storage.js");
  const recorder = canvasRecorder();
  const scenes = CHARACTERS.map((character) => createBattleScene({ character, onExit() {} }));
  scenes.forEach((scene) => scene.__test.drawPlayer(recorder.ctx));
  const encounter = scenes[0].__test;
  encounter.state.flashEffectsOn = false;
  encounter.state.enemies = enemyInventory(env);
  encounter.drawEnemies(recorder.ctx);
  for (const id of ["mechanic", "vampire"]) {
    const scene = scenes[CHARACTERS.findIndex((c) => c.id === id)].__test;
    scene.drawBullets(recorder.ctx);
  }
  assert.equal(env.createdImages.length, 0, "disabled scenes must not eagerly load old or new sprites");
  assert.equal(recorder.draws.length, 0, "Taffy must honor disabled textures too");
  storage.setBattleTexturesOn(true);
  for (const scene of scenes) {
    const before = recorder.draws.length;
    scene.__test.drawPlayer(recorder.ctx);
    assert.equal(recorder.draws.length, before + 1, scene.__test.state.characterId);
  }
  const beforeEnemies = recorder.draws.length;
  encounter.drawEnemies(recorder.ctx);
  assert.equal(recorder.draws.length, beforeEnemies + 32, "all enemy bodies must switch to textures in the existing scene");
  for (const id of ["mechanic", "vampire"]) {
    const before = recorder.draws.length;
    const scene = scenes[CHARACTERS.findIndex((c) => c.id === id)].__test;
    scene.drawBullets(recorder.ctx);
    const expected = id === "vampire" ? "satellite_vampire.png" : "satellite_orbital.png";
    assert.ok(recorder.draws.slice(before).some((draw) => draw.assetPath.endsWith(expected)), `${id} satellite must activate after the toggle`);
  }
  const requests = env.requests.length;
  const draws = recorder.draws.length;
  storage.setBattleTexturesOn(false);
  scenes.forEach((scene) => { scene.__test.drawPlayer(recorder.ctx); scene.__test.drawBullets(recorder.ctx); });
  encounter.drawEnemies(recorder.ctx);
  assert.equal(env.requests.length, requests);
  assert.equal(recorder.draws.length, draws);
  assert.equal(recorder.stack.length, 0);
  assert.deepEqual(recorder.errors, []);
});
