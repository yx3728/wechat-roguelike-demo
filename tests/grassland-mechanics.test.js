"use strict";

// node --test tests/grassland-mechanics.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");

function modules() {
  const context = vm.createContext({ console, wx: {
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }),
  } });
  const cache = new Map();
  function load(relative) {
    let filename = path.resolve(ROOT, relative);
    if (!path.extname(filename)) filename += ".js";
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const source = fs.readFileSync(filename, "utf8");
    new vm.Script(`(function(require,module,exports){\n${source}\n})`, { filename })
      .runInContext(context)((request) => load(path.resolve(path.dirname(filename), request)), mod, mod.exports);
    return mod.exports;
  }
  return { load };
}
function setup(initialize = true) {
  const env = modules();
  const mechanics = env.load("src/mechanics.js");
  const habitat = env.load("src/grasslandMechanics.js");
  const state = Object.assign(mechanics.mechanicDefaults(), { mapId: "grassland", elapsed: 0,
    maxHp: 2000, hp: 1000, bulletDamage: 800, shootInterval: 400, expMul: 1,
    player: { x: 0, y: 0, w: 20, h: 20 }, eliteDmgMul: 0.8, bossDmgMul: 0.65 });
  const pool = env.load("src/upgrades.js").UPGRADE_POOL;
  function apply(id) {
    const item = pool.find((entry) => entry.id === id);
    assert.ok(item, id);
    assert.equal(item.available(state), true, id);
    item.apply(state);
    return item;
  }
  if (initialize) habitat.initGrasslandHabitat(state, 390, 844);
  return { ...env, ...habitat, mechanics, state, pool, apply };
}
function putPlayer(state, x, y) { state.player.x = x - 10; state.player.y = y - 10; }
function shotAt(x, y) { return { x: x - 2, y: y - 2, w: 4, h: 4, dmg: 1e9 }; }

test("habitat replaces crosswind and allocates five independent cover clumps per battle", () => {
  const env = setup(false);
  assert.equal(env.mechanics.getMechanic("crosswind"), null);
  assert.equal(env.mechanics.getMechanic("grasslandHabitat"), env.grasslandHabitat);
  assert.equal(env.grasslandHabitat.devModes, null);
  assert.equal(env.state.grassCover, null);
  assert.equal(env.state.grassRootBuds, null);
  assert.equal(env.state.grassVines, null);
  assert.equal(env.state.grassWindPhase, undefined);
  env.initGrasslandHabitat(env.state, 390, 844);
  assert.equal(env.state.grassCover.length, 5);
  const layout = [[0.18, 0.43], [0.76, 0.43], [0.46, 0.60], [0.18, 0.77], [0.81, 0.78]];
  env.state.grassCover.forEach((cover, i) => {
    assert.equal(cover.x, layout[i][0] * 390);
    assert.equal(cover.y, layout[i][1] * 844);
    assert.equal(cover.hp, 8);
    assert.equal(cover.maxHp, 8);
    assert.ok(cover.r >= 28 && cover.r <= 36);
  });
  const other = Object.assign(env.mechanics.mechanicDefaults(), { player: { x: 0, y: 0, w: 20, h: 20 } });
  env.initGrasslandHabitat(other, 320, 720);
  assert.notEqual(other.grassCover, env.state.grassCover);
  assert.notEqual(other.grassCover[0], env.state.grassCover[0]);
  assert.notEqual(other.grassRootBuds, env.state.grassRootBuds);
  assert.equal(other.grassCover[0].x, 0.18 * 320);
  const before = JSON.stringify(env.state.player);
  env.updateGrasslandHabitat(env.state, 100000, 390, 844);
  assert.equal(JSON.stringify(env.state.player), before, "habitat never pushes the player");
  assert.equal(env.state.expMul, 1);
  assert.equal(env.state.bulletDamage, 800);
  assert.equal(env.state.shootInterval, 400);
});

test("cover consumes eight hostile shots, passes player shots and restores after 14 seconds", () => {
  const env = setup(), cover = env.state.grassCover[0], bullet = shotAt(cover.x, cover.y);
  assert.equal(env.interceptGrassBullet(env.state, bullet, true), false);
  assert.equal(cover.hp, 8);
  for (let i = 0; i < 8; i += 1) assert.equal(env.interceptGrassBullet(env.state, bullet, false), true);
  assert.equal(cover.active, false);
  assert.equal(cover.hp, 0);
  assert.equal(cover.regrowMs, 14000);
  assert.equal(env.interceptGrassBullet(env.state, bullet, false), false);
  env.updateGrasslandHabitat(env.state, 13999, 390, 844);
  assert.equal(cover.active, false);
  env.updateGrasslandHabitat(env.state, 1, 390, 844);
  assert.equal(cover.active, true);
  assert.equal(cover.hp, 8);
});

test("swept projectile tests hit the nearest terrain object even when the bullet crosses it in one frame", () => {
  const env = setup();
  const near = { ...env.state.grassCover[0], x: 100, y: 100, r: 20 };
  const far = { ...env.state.grassCover[1], x: 200, y: 100, r: 20 };
  env.state.grassCover = [far, near];
  const fast = { x: 300, y: 98, w: 4, h: 4 };
  assert.equal(env.interceptGrassBullet(env.state, fast, false, 0, 98), true);
  assert.equal(near.hp, 7);
  assert.equal(far.hp, 8);
  const bud = env.plantRootBud(env.state, 160, 100, { hp: 10 });
  assert.equal(env.interceptGrassBullet(env.state, fast, true, 0, 98), true);
  assert.equal(bud.hp, 2);
  assert.equal(near.hp, 7, "player shots only damage root buds");
});

test("concealment depends on live cover and ambush is consumed once per cover entry", () => {
  const env = setup();
  env.apply("grass_ambush");
  const first = env.state.grassCover[0], second = env.state.grassCover[1];
  putPlayer(env.state, first.x, first.y);
  env.updateGrasslandHabitat(env.state, 0, 390, 844);
  assert.equal(env.state.grassConcealed, true);
  assert.equal(env.consumeGrassAmbush(env.state), 1.4);
  assert.equal(env.consumeGrassAmbush(env.state), 1);
  putPlayer(env.state, second.x, second.y);
  assert.equal(env.consumeGrassAmbush(env.state), 1.4, "a fast drag into a different cover is a new entry");
  putPlayer(env.state, 20, 20);
  env.updateGrasslandHabitat(env.state, 0, 390, 844);
  assert.equal(env.state.grassConcealed, false);
  putPlayer(env.state, first.x, first.y);
  env.updateGrasslandHabitat(env.state, 0, 390, 844);
  putPlayer(env.state, 20, 20);
  assert.equal(env.consumeGrassAmbush(env.state), 1, "leaving cover discards an unused ambush");
  putPlayer(env.state, first.x, first.y);
  env.updateGrasslandHabitat(env.state, 0, 390, 844);
  env.crushCover(env.state, first.x, first.y, 0);
  assert.equal(env.state.grassConcealed, false);
  assert.equal(env.consumeGrassAmbush(env.state), 1);
  assert.equal(env.state.hp, 1000, "concealment and crushing do not directly damage the player");
});

test("rabbits can add only two cover clumps and cover upgrades apply to existing and future clumps", () => {
  const env = setup();
  env.apply("grass_cover");
  assert.equal(env.state.grassCover[0].hp, 12);
  const sixth = env.plantCover(env.state, 120, 420);
  const seventh = env.plantCover(env.state, 240, 420);
  assert.equal(sixth.hp, 12);
  assert.equal(seventh.maxHp, 12);
  assert.equal(env.plantCover(env.state, 180, 440), null);
  env.crushCover(env.state, sixth.x, sixth.y, 0);
  assert.equal(env.plantCover(env.state, 180, 440), null, "destroyed fixed cover reserves its regrowth position");
  assert.equal(env.state.grassCover.length, 7);
  const beforeInit = setup(false);
  beforeInit.apply("grass_cover");
  beforeInit.initGrasslandHabitat(beforeInit.state, 390, 844);
  assert.equal(beforeInit.state.grassCover[0].maxHp, 12);
});

test("three player hits destroy a root bud, sever only connected vines and award healing once", () => {
  const env = setup(), owner = { hp: 10 };
  env.apply("grass_pruning");
  const a = env.plantRootBud(env.state, 100, 180, owner);
  const b = env.plantRootBud(env.state, 200, 180, owner);
  const c = env.plantRootBud(env.state, 280, 240, owner);
  env.plantVine(env.state, a, b, owner);
  env.plantVine(env.state, a, c, owner);
  const survivor = env.plantVine(env.state, b, c, owner);
  const bullet = shotAt(a.x, a.y);
  for (let i = 0; i < 2; i += 1) {
    assert.equal(env.interceptGrassBullet(env.state, bullet, true), true);
    assert.equal(env.state.grassVines.length, 3);
  }
  assert.equal(a.hp, 1, "very large projectile damage still counts as one of three hits");
  assert.equal(env.interceptGrassBullet(env.state, bullet, true), true);
  assert.equal(env.state.grassRootBuds.length, 2);
  assert.equal(env.state.grassVines.length, 1);
  assert.equal(env.state.grassVines[0], survivor);
  assert.equal(env.interceptGrassBullet(env.state, bullet, true), false);
  assert.equal(env.consumeGrasslandRewards(env.state).healAmount, 60);
  assert.equal(env.consumeGrasslandRewards(env.state).healAmount, 0);
  assert.equal(env.state.hp, 1000, "battle owns healing caps and side effects");
  owner.hp = 0;
  env.updateGrasslandHabitat(env.state, 0, 390, 844);
  assert.equal(env.state.grassRootBuds.length, 0);
  assert.equal(env.state.grassVines.length, 0);
  assert.equal(env.consumeGrasslandRewards(env.state).healAmount, 0, "owner death is not a player bud kill");
});

test("vines telegraph for 650ms and remain active for exactly five seconds while buds mature independently", () => {
  const env = setup(), owner = { hp: 10 };
  const a = env.plantRootBud(env.state, 100, 180, owner), b = env.plantRootBud(env.state, 200, 180, owner);
  const vine = env.plantVine(env.state, a, b, owner);
  env.updateGrasslandHabitat(env.state, 649, 390, 844);
  assert.equal(vine.active, false);
  assert.equal(a.active, false);
  env.updateGrasslandHabitat(env.state, 1, 390, 844);
  assert.equal(vine.active, true);
  assert.equal(a.active, true);
  assert.equal(vine.lifeMs, 5000);
  env.updateGrasslandHabitat(env.state, 4999, 390, 844);
  assert.equal(env.state.grassVines.length, 1);
  env.updateGrasslandHabitat(env.state, 1, 390, 844);
  assert.equal(env.state.grassVines.length, 0);
  assert.equal(env.state.grassRootBuds.length, 2);
  env.updateGrasslandHabitat(env.state, 10350, 390, 844);
  assert.equal(env.state.grassRootBuds.length, 0);
});

test("a fast drag crossing an active vine is slowed with 600ms linger, without instant damage", () => {
  const env = setup();
  env.plantVine(env.state, { x: 200, y: 200 }, { x: 200, y: 500 }, { hp: 10 });
  assert.equal(env.grassPlayerMoveMul(env.state, 0, 300, 370, 300), 1, "telegraph is not yet a snare");
  env.updateGrasslandHabitat(env.state, 650, 390, 844);
  assert.equal(env.grassPlayerMoveMul(env.state, 0, 300, 370, 300), 0.55);
  assert.equal(env.state.grassSnaredMs, 600);
  assert.equal(env.state.hp, 1000);
  env.updateGrasslandHabitat(env.state, 599, 390, 844);
  assert.equal(env.grassPlayerMoveMul(env.state), 0.55);
  env.updateGrasslandHabitat(env.state, 1, 390, 844);
  assert.equal(env.grassPlayerMoveMul(env.state), 1);
  env.apply("grass_freestep");
  assert.equal(env.grassPlayerMoveMul(env.state, 0, 300, 370, 300), 1);
  assert.equal(env.state.grassSnaredMs, 0);
});

test("only breaking occupied cover grants shelter shields and repeated destruction cannot duplicate rewards", () => {
  const env = setup();
  env.apply("grass_shelter");
  const cover = env.state.grassCover[0];
  putPlayer(env.state, cover.x, cover.y);
  env.updateGrasslandHabitat(env.state, 0, 390, 844);
  for (let i = 0; i < 8; i += 1) env.interceptGrassBullet(env.state, shotAt(cover.x, cover.y), false);
  assert.equal(env.consumeGrasslandRewards(env.state).shieldAmount, 100);
  assert.equal(env.crushCover(env.state, cover.x, cover.y, 0), 0);
  assert.equal(env.consumeGrasslandRewards(env.state).shieldAmount, 0);
  const remote = env.state.grassCover[1];
  assert.equal(env.crushCover(env.state, remote.x, remote.y, 0), 1);
  assert.equal(env.consumeGrasslandRewards(env.state).shieldAmount, 0);
});

test("regrowth reduces both an existing countdown and future regrowth to 8.4 seconds", () => {
  const env = setup(), cover = env.state.grassCover[0];
  env.crushCover(env.state, cover.x, cover.y, 0);
  env.apply("grass_regrowth");
  assert.equal(cover.regrowMs, 8400);
  env.updateGrasslandHabitat(env.state, 8400, 390, 844);
  assert.equal(cover.active, true);
  env.crushCover(env.state, cover.x, cover.y, 0);
  assert.equal(cover.regrowMs, 8400);
});

test("all six terrain hexes are grassland-only, single-pick and grant no global fire, XP or elite bonuses", () => {
  const env = setup();
  const entries = env.pool.filter((entry) => entry.id.startsWith("grass_"));
  assert.equal(entries.length, 6);
  for (const mapId of ["ocean", "desert", "starfield", undefined]) {
    entries.forEach((entry) => assert.equal(entry.available({ mapId }), false));
  }
  entries.forEach((entry) => env.apply(entry.id));
  entries.forEach((entry) => assert.equal(entry.available(env.state), false));
  assert.equal(env.state.maxHp, 2000);
  assert.equal(env.state.bulletDamage, 800);
  assert.equal(env.state.shootInterval, 400);
  assert.equal(env.state.expMul, 1);
  assert.equal(env.state.eliteDmgMul, 0.8);
  assert.equal(env.state.bossDmgMul, 0.65);
  assert.equal(env.state.grassCoverCapacityBonus, 4);
  assert.equal(env.state.grassCoverRegenMul, 0.6);
  assert.equal(env.state.grassAmbushDamageMul, 1.4);
  assert.equal(env.state.grassBudHealRatio, 0.03);
  assert.equal(env.state.grassCoverBreakShieldRatio, 0.05);
  assert.equal(env.state.grassSnareImmune, true);
});
