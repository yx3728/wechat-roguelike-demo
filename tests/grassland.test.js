"use strict";

// Run from the project root: node --test tests/grassland.test.js
//
// 这个文件取代了 grassland-battle.test.js 与 grassland-motion.test.js。
// 那两个文件写于「侧风（crosswind）」方案时期，断言的是一套**已被放弃的设计**：
// 侧风机制、grass_tailwind/grass_seed 等六条词条、以及 antlerFan/hoofStamp/
// galeCorridor 三个 Boss 招式——这些在 src/ 里从来没有实现过。
// 现行草原走的是「栖息地（habitat）」方案：草丛掩体 + 根芽 + 藤蔓，
// 五种行为各异的敌人，Boss 招式为 antlerPlow / herdGuard / rootGarden。
//
// 这里测的是**发货版本的不变量**，不是当前输出的快照：
//   · 地图串起来的注册项正确、专属词条只在草原出现且一局一次
//   · 每一发子弹之前都必须有可见预警（预警相必须叫 "warn"，视觉层据此画预警圈）
//   · 预警期间不位移、锁定目标不变
//   · Boss 不瞬移、不死锁、每次预警时长自洽

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const WIDTH = 390;
const HEIGHT = 844;

function harness() {
  const context = vm.createContext({
    wx: { getWindowInfo: () => ({ windowWidth: WIDTH, windowHeight: HEIGHT, pixelRatio: 1 }) },
  });
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
    load,
    enemies: load("src/enemies.js"),
    habitat: load("src/grasslandMechanics.js"),
    maps: load("src/maps.js"),
    mechanics: load("src/mechanics.js"),
    upgrades: load("src/upgrades.js"),
    updateBoss: load("subpackages/pkg_boss/src/bossAi.js").updateBoss,
  };
}

/** 草原敌人的行为建立在草丛/根芽/藤蔓之上，state 必须先初始化栖息地 */
function grassState(h, extra) {
  const state = Object.assign({
    player: { x: 175, y: 700, w: 32, h: 36 },
    elapsed: 0,
    enemies: [],
    bullets: [],
    enemyBullets: [],
  }, extra || {});
  h.habitat.initGrasslandHabitat(state, WIDTH, HEIGHT);
  return state;
}

// ---------------------------------------------------------------------------

test("草原地图串起来的注册项都存在，且与其它地图互不串味", () => {
  const h = harness();
  const map = h.maps.getMapById("grassland");
  assert.ok(map, "grassland 地图存在");
  assert.equal(map.enemyPool, "grassland");
  assert.equal(map.eliteType, "thunderBison");
  assert.equal(map.bossVariant, "antlerKing");

  const errors = h.maps.validateMaps({
    enemyPools: h.enemies.ENEMY_POOLS,
    eliteFactories: h.enemies.ELITE_FACTORIES,
    bossVariants: h.enemies.BOSS_VARIANTS,
    mechanics: h.mechanics.MECHANICS,
  });
  // errors 是在 vm 上下文里创建的数组，原型与宿主 realm 不同，
  // deepStrictEqual 会因此判不等 —— 比内容即可
  assert.equal(errors.length, 0, "所有地图引用有效：" + Array.from(errors).join(" / "));

  // 现行方案是栖息地，不是侧风；确认没有回潮
  assert.equal(h.mechanics.getMechanic("crosswind"), null, "侧风方案已废弃，不应重新出现");
  assert.ok(h.mechanics.getMechanic("grasslandHabitat"), "栖息地机制已注册");
  assert.ok(map.mechanics.grasslandHabitat, "草原启用栖息地机制");
});

test("草原专属词条只在草原候选，且每局各自最多一次", () => {
  const h = harness();
  const pool = h.upgrades.UPGRADE_POOL;
  const grass = pool.filter((u) => u.maps && u.maps.indexOf("grassland") >= 0);
  assert.ok(grass.length >= 6, `草原专属词条 ${grass.length} 条`);

  const meta = () => ({ picked: Object.create(null), blocked: Object.create(null) });
  const onGrass = { mapId: "grassland", _upgradeMeta: meta() };
  const elsewhere = ["starfield", "desert", "ocean"].map((id) => ({ mapId: id, _upgradeMeta: meta() }));

  grass.forEach((u) => {
    assert.equal(u.available(onGrass), true, `${u.id} 在草原可用`);
    elsewhere.forEach((s) => {
      assert.equal(u.available(s), false, `${u.id} 不该出现在 ${s.mapId}`);
    });
  });

  // 拿过一次之后不再出现（专属词条都是一次性）
  grass.forEach((u) => u.apply(onGrass));
  grass.forEach((u) => {
    assert.equal(u.available(onGrass), false, `${u.id} 不能重复获取`);
  });
});

test("每一发草原子弹之前都有可见预警，且预警期间不位移、不改锁定", () => {
  const h = harness();
  const roster = [
    "createMeadowHare", "createBladeMantis", "createLanternBeetle",
    "createThornBloom", "createGaleFalcon", "createThunderBison",
  ];
  assert.equal(h.enemies.ENEMY_POOLS.grassland.length, 5, "草原刷怪池五种杂兵");

  let shooters = 0;
  for (const factory of roster) {
    const enemy = h.enemies[factory](8);
    const state = grassState(h, {});
    state.enemies = [enemy];

    let warned = false;
    let shots = 0;
    let previousPhase;
    let anchor = null;

    for (let elapsed = 0; elapsed < 22000; elapsed += 16) {
      state.elapsed = elapsed;
      h.enemies.updateEnemy(enemy, 16, state);
      h.enemies.maybeFire(enemy, 16, state, (bullet) => {
        // 核心不变量：没有预警就不许有子弹
        assert.ok(warned, `${enemy.type} 未经预警就开火`);
        assert.ok([bullet.x, bullet.y, bullet.vx, bullet.vy].every(Number.isFinite),
          `${enemy.type} 的子弹坐标必须有限`);
        shots += 1;
      });

      assert.ok([enemy.x, enemy.y, enemy.w, enemy.h].every(Number.isFinite),
        `${enemy.type} 的位置必须有限`);

      if (enemy.grassAttackPhase === "warn") {
        warned = true;
        if (previousPhase !== "warn") {
          anchor = { x: enemy.x, y: enemy.y, target: JSON.stringify(enemy.grassTarget) };
        } else {
          // 预警是给玩家读的：读的时候位置和锁定目标都不能变
          assert.equal(enemy.x, anchor.x, `${enemy.type} 在预警期间移动了`);
          assert.equal(enemy.y, anchor.y, `${enemy.type} 在预警期间移动了`);
          assert.equal(JSON.stringify(enemy.grassTarget), anchor.target,
            `${enemy.type} 在预警期间改了锁定目标`);
        }
      }
      previousPhase = enemy.grassAttackPhase;
    }
    if (shots > 0) shooters += 1;
  }
  assert.ok(shooters >= 2, `至少两种草原敌人会射击（实际 ${shooters}）`);
});

test("预警相必须叫 warn —— 视觉层只按这个名字画预警圈", () => {
  const h = harness();
  const visuals = h.load("src/grasslandVisuals.js");
  assert.ok(typeof visuals.drawGrasslandOverlay === "function");

  // 这条锁住的是一个真实修过的 bug：灯笼甲虫曾把蓄力相叫 "windup"，
  // 而 grasslandVisuals 只在 grassAttackPhase === "warn" 时画预警圈，
  // 结果它蓄力 1000ms 玩家却完全看不到预警。
  const beetle = h.enemies.createLanternBeetle(8);
  const state = grassState(h, {});
  state.enemies = [beetle];
  const phases = new Set();
  for (let elapsed = 0; elapsed < 22000; elapsed += 16) {
    state.elapsed = elapsed;
    h.enemies.updateEnemy(beetle, 16, state);
    phases.add(beetle.grassAttackPhase);
  }
  assert.ok(phases.has("warn"), "甲虫的蓄力相必须命名为 warn");
  assert.ok(!phases.has("windup"), "不允许再出现视觉层认不出的 windup");
});

test("苍岚鹿王：不瞬移、不死锁、每次预警时长自洽", () => {
  for (const frameMs of [16, 33]) {
    const h = harness();
    const boss = h.enemies.createBoss("antlerKing", 10);
    boss.entered = true;
    boss.x = WIDTH / 2 - boss.w / 2;
    boss.y = 90;
    const state = grassState(h, {});
    state.enemies = [boss];

    const attacks = new Set();
    const states = new Set();
    let lastState;
    let warnAnchor = null;
    let warnMsAtStart = 0;

    for (let elapsed = 0; elapsed < 180000; elapsed += frameMs) {
      state.elapsed = elapsed;
      const beforeX = boss.x;
      const beforeY = boss.y;
      h.updateBoss(boss, frameMs, state, (b) => state.enemyBullets.push(b), () => {});

      // 犁地冲锋本来就快（实测约 6.7px/帧）；这里抓的是**不连续的瞬移**，不是限速
      const moved = Math.hypot(boss.x - beforeX, boss.y - beforeY);
      assert.ok(moved < 9 * frameMs / 16.667 + 1,
        `Boss 瞬移了 ${moved.toFixed(1)}px（${boss.grassState}）`);
      assert.ok([boss.x, boss.y].every(Number.isFinite), "Boss 坐标必须有限");

      if (boss.grassAttack) attacks.add(boss.grassAttack);
      states.add(boss.grassState);

      if (boss.grassState === "warn") {
        assert.ok(boss.grassWarnMs >= 800 && boss.grassWarnMs <= 1400,
          `预警时长越界：${boss.grassWarnMs}`);
        if (lastState !== "warn") {
          warnAnchor = { x: boss.x, y: boss.y };
          warnMsAtStart = boss.grassWarnMs;
        } else {
          // 同一次预警内，时长与位置都不能变，否则读不出来
          assert.equal(boss.grassWarnMs, warnMsAtStart, "同一次预警的时长被改动");
          assert.equal(boss.x, warnAnchor.x, "Boss 在预警期间移动了");
          assert.equal(boss.y, warnAnchor.y, "Boss 在预警期间移动了");
        }
      }
      lastState = boss.grassState;

      state.enemyBullets.forEach((b) => { b.x += b.vx || 0; b.y += b.vy || 0; });
      state.enemyBullets = state.enemyBullets.filter(
        (b) => b.x > -60 && b.x < WIDTH + 60 && b.y > -60 && b.y < HEIGHT + 60,
      );
    }

    // 三招都要轮到，不能卡死在某一招上
    ["antlerPlow", "herdGuard", "rootGarden"].forEach((a) => {
      assert.ok(attacks.has(a), `${frameMs}ms 帧长下没轮到招式 ${a}`);
    });
    assert.ok(states.has("warn"), "必须有预警相");
    assert.ok(states.has("idle"), "招式之间必须回到 idle，否则是死锁");
  }
});
