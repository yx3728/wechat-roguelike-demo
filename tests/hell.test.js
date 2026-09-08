"use strict";

// Run from the project root: node --test tests/hell.test.js
//
// 锁的是**发货版本的不变量**，不是当前输出的快照。地狱这张图有两条设计红线，
// 破了任何一条这张图就不成立，所以它们各有一个专门的用例：
//   1. 击杀亡魂**不产生新魂火** —— 否则回路递归，场面永远收不回来
//   2. 魂火 / 亡魂都有硬上限 —— 无论玩家 DPS 多离谱，场面有天花板
// 另外照草原的规矩：没有预警就不许有子弹，预警期间不位移、不改锁定。

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
    Math,
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
    hell: load("src/hellMechanics.js"),
    hellEnemies: load("src/hellEnemies.js"),
    maps: load("src/maps.js"),
    mechanics: load("src/mechanics.js"),
    upgrades: load("src/upgrades.js"),
    updateBoss: load("subpackages/pkg_boss/src/bossAi.js").updateBoss,
  };
}

function hellState(h, extra) {
  const state = Object.assign({
    player: { x: 175, y: 700, w: 32, h: 36 },
    elapsed: 0,
    level: 8,
    enemies: [],
    bullets: [],
    enemyBullets: [],
  }, extra || {});
  h.hell.initHellfire(state);
  return state;
}

/** 把机制排出来的亡魂请求兑现成敌人——battle.js applyHellfireResults 干的事 */
function flushRevenants(h, state) {
  h.hell.consumeHellRevenantRequests(state).forEach((req) => {
    state.enemies.push(h.hellEnemies.createRevenant(req));
  });
}

// ---------------------------------------------------------------------------

test("地狱地图串起来的注册项都存在，且没有串错 id", () => {
  const h = harness();
  const map = h.maps.getMapById("hell");
  assert.ok(map, "hell 地图存在");
  assert.equal(map.enemyPool, "hell");
  assert.equal(map.eliteType, "warden");
  assert.equal(map.bossVariant, "yama");
  assert.equal(map.unlockBy, "mapClear");
  assert.equal(map.unlockMapId, "grassland");
  assert.ok(map.mechanics.hellfireRevenant, "启用业火回魂机制");

  const errors = h.maps.validateMaps({
    enemyPools: h.enemies.ENEMY_POOLS,
    eliteFactories: h.enemies.ELITE_FACTORIES,
    bossVariants: h.enemies.BOSS_VARIANTS,
    mechanics: h.mechanics.MECHANICS,
  });
  assert.equal(errors.length, 0, "所有地图引用有效：" + Array.from(errors).join(" / "));

  assert.equal(h.enemies.ENEMY_POOLS.hell.length, 5, "地狱刷怪池五种杂兵");
  h.enemies.ENEMY_POOLS.hell.forEach((entry) => {
    assert.ok(h.enemies.ENEMY_FACTORIES[entry.type], `${entry.type} 已登记进 ENEMY_FACTORIES`);
  });
  assert.ok(h.mechanics.getMechanic("hellfireRevenant"), "机制已注册");
});

test("地狱专属词条只在地狱候选，且每局各自最多一次", () => {
  const h = harness();
  const hell = h.upgrades.UPGRADE_POOL.filter((u) => u.maps && u.maps.indexOf("hell") >= 0);
  assert.equal(hell.length, 6, `地狱专属词条 ${hell.length} 条`);

  const meta = () => ({ picked: Object.create(null), blocked: Object.create(null) });
  const onHell = { mapId: "hell", _upgradeMeta: meta() };
  const elsewhere = ["starfield", "desert", "ocean", "grassland"].map((id) => ({ mapId: id, _upgradeMeta: meta() }));

  hell.forEach((u) => {
    assert.equal(u.available(onHell), true, `${u.id} 在地狱可用`);
    elsewhere.forEach((s) => assert.equal(u.available(s), false, `${u.id} 不该出现在 ${s.mapId}`));
  });
  hell.forEach((u) => u.apply(onHell));
  hell.forEach((u) => assert.equal(u.available(onHell), false, `${u.id} 不能重复获取`));
});

test("红线一：击杀亡魂不产生新魂火，回路不会递归", () => {
  const h = harness();
  const state = hellState(h);

  // 一只普通敌人死 → 掉魂火
  const husk = h.hellEnemies.createCinderHusk(8);
  husk.x = 180; husk.y = 400;
  h.hellEnemies.spawnSoulfireFor(husk, state, 8);
  assert.equal(state.hellSoulfires.length, 1, "普通敌人死后留下魂火");

  // 引信烧完 → 回魂
  state.player.y = 10; // 玩家离得远，不会被判定为镇魂
  for (let t = 0; t < 8000; t += 16) h.hell.updateHellfire(state, 16);
  flushRevenants(h, state);
  const revenant = state.enemies.find((e) => e.isHellRevenant);
  assert.ok(revenant, "引信烧完后站起一只亡魂");
  assert.equal(state.hellSoulfires.length, 0);

  // 亡魂死 → **不掉魂火**
  const before = state.hellSoulfires.length;
  const made = h.hellEnemies.spawnSoulfireFor(revenant, state, 8);
  assert.equal(made, null, "spawnSoulfireFor 对亡魂返回 null");
  assert.equal(state.hellSoulfires.length, before, "击杀亡魂不产生新魂火");
});

test("红线二：魂火 14 个、亡魂 8 只的上限在极端 DPS 下也成立", () => {
  const h = harness();
  const state = hellState(h);
  state.player.x = -500; // 玩家在场外，全部魂火都会走到回魂

  // 模拟一个离谱构筑：每帧杀一只
  for (let i = 0; i < 400; i += 1) {
    const husk = h.hellEnemies.createCinderHusk(8);
    husk.x = 40 + (i * 37) % 300;
    husk.y = 120 + (i * 53) % 600;
    h.hellEnemies.spawnSoulfireFor(husk, state, 8);
    h.hell.updateHellfire(state, 16);
    flushRevenants(h, state);
    assert.ok(state.hellSoulfires.length <= h.hell.SOULFIRE_CAP,
      `第 ${i} 帧魂火 ${state.hellSoulfires.length} 超过上限 ${h.hell.SOULFIRE_CAP}`);
    assert.ok(state.enemies.filter((e) => e.isHellRevenant && e.hp > 0).length <= h.hell.REVENANT_CAP,
      `第 ${i} 帧亡魂超过上限 ${h.hell.REVENANT_CAP}`);
  }
  assert.ok(state.enemies.some((e) => e.isHellRevenant), "确实生成过亡魂（否则这条测试是空跑）");
});

test("镇魂加一层业火、回魂加罪值；罪值只走这两个事件", () => {
  const h = harness();
  const state = hellState(h);
  assert.equal(state.hellSin, h.hell.SIN_START);

  // 镇魂：把玩家放在魂火上
  const fire = h.hell.dropSoulfire(state, 175, 700, {});
  state.player.x = fire.x - 16; state.player.y = fire.y - 18;
  h.hell.updateHellfire(state, 16);
  assert.equal(state.hellEmber.length, 1, "镇魂 +1 层业火");
  assert.equal(state.hellSin, h.hell.SIN_START + h.hell.SIN_ON_BANK, "镇魂降罪值");
  assert.ok(h.hell.hellEmberDamageMul(state) > 1, "业火提升主炮伤害");

  // 业火按层独立计时，掉层不是整体清零
  for (let t = 0; t < 6000; t += 16) h.hell.updateHellfire(state, 16);
  assert.equal(state.hellEmber.length, 0, "业火层会过期");

  // 回魂：罪值上升
  const sinBefore = state.hellSin;
  state.player.x = -500;
  h.hell.dropSoulfire(state, 200, 300, {});
  for (let t = 0; t < 8000; t += 16) h.hell.updateHellfire(state, 16);
  assert.equal(state.hellSin, sinBefore + h.hell.SIN_ON_RISE, "回魂升罪值");
});

test("每一发地狱子弹之前都有可见预警，且预警期间不位移、不改锁定", () => {
  const h = harness();
  const roster = ["createCinderHusk", "createSoulPicker", "createBrandBearer",
    "createChainWarden", "createForgeGullet", "createWarden"];

  let shooters = 0;
  for (const factory of roster) {
    const enemy = h.enemies[factory] ? h.enemies[factory](8) : h.hellEnemies[factory](8);
    const state = hellState(h);
    state.enemies = [enemy];

    let warned = false;
    let shots = 0;
    let previousPhase;
    let anchor = null;

    for (let elapsed = 0; elapsed < 22000; elapsed += 16) {
      state.elapsed = elapsed;
      h.hell.updateHellfire(state, 16);
      h.enemies.updateEnemy(enemy, 16, state);
      h.enemies.maybeFire(enemy, 16, state, (bullet) => {
        assert.ok(warned, `${enemy.type} 未经预警就开火`);
        assert.ok([bullet.x, bullet.y, bullet.vx, bullet.vy].every(Number.isFinite),
          `${enemy.type} 的子弹坐标必须有限`);
        shots += 1;
      });
      assert.ok([enemy.x, enemy.y, enemy.w, enemy.h].every(Number.isFinite),
        `${enemy.type} 的位置必须有限`);

      if (enemy.hellAttackPhase === "warn") {
        warned = true;
        if (previousPhase !== "warn") {
          anchor = { x: enemy.x, y: enemy.y, target: JSON.stringify(enemy.hellTarget) };
        } else {
          assert.equal(enemy.x, anchor.x, `${enemy.type} 在预警期间移动了`);
          assert.equal(enemy.y, anchor.y, `${enemy.type} 在预警期间移动了`);
          assert.equal(JSON.stringify(enemy.hellTarget), anchor.target,
            `${enemy.type} 在预警期间改了锁定目标`);
        }
      }
      previousPhase = enemy.hellAttackPhase;
    }
    if (shots > 0) shooters += 1;
  }
  assert.ok(shooters >= 3, `至少三种地狱敌人会射击（实际 ${shooters}）`);
});

test("拾魂者跟玩家抢魂火，刑官死亡把全场引信压到 1.5 秒", () => {
  const h = harness();

  const state = hellState(h);
  state.player.x = -500;
  const fire = h.hell.dropSoulfire(state, 200, 400, {});
  const picker = h.hellEnemies.createSoulPicker(8);
  picker.x = 200; picker.y = 200;
  state.enemies = [picker];
  for (let t = 0; t < 4000 && state.hellSoulfires.length > 0; t += 16) {
    h.enemies.updateEnemy(picker, 16, state);
    h.hell.updateHellfire(state, 16);
  }
  assert.equal(state.hellSoulfires.indexOf(fire), -1, "拾魂者把魂火吃掉了");
  assert.ok(picker.hellEaten >= 1, "吃过之后有记录");

  const s2 = hellState(h);
  s2.player.x = -500;
  h.hell.dropSoulfire(s2, 100, 200, { fuseMs: 9000 });
  h.hell.dropSoulfire(s2, 300, 500, { fuseMs: 9000 });
  const warden = h.hellEnemies.createWarden(8);
  h.hellEnemies.onHellEnemyKilled(warden, s2);
  s2.hellSoulfires.forEach((f) => {
    assert.ok(f.fuseMs <= 1500, `刑官死后引信应压到 1.5 秒，实际 ${f.fuseMs}`);
  });
});

test("阎罗：不瞬移、不死锁、三招都轮得到，罪值决定招式池与承伤", () => {
  for (const frameMs of [16, 33]) {
    const h = harness();
    const boss = h.enemies.createBoss("yama", 10);
    boss.bossVariant = "yama";
    boss.entered = true;
    boss.x = WIDTH / 2 - boss.w / 2;
    boss.y = 90;
    const state = hellState(h);
    state.enemies = [boss];
    state.player.x = -500; // 玩家不去收魂火 → 罪值一路涨到满

    const attacks = new Set();
    const states = new Set();
    let lastState;
    let warnAnchor = null;
    let warnMsAtStart = 0;
    let sawLowSinBonus = false;
    let sawVerdictWhileLowSin = false;

    for (let elapsed = 0; elapsed < 180000; elapsed += frameMs) {
      state.elapsed = elapsed;
      if (elapsed % 1200 < frameMs) h.hell.dropSoulfire(state, 60 + (elapsed % 260), 300 + (elapsed % 300), {});
      h.hell.updateHellfire(state, frameMs);
      h.hell.consumeHellRevenantRequests(state); // 不真造亡魂，只清队列

      const beforeX = boss.x, beforeY = boss.y;
      h.updateBoss(boss, frameMs, state, (b) => state.enemyBullets.push(b), () => {});

      const moved = Math.hypot(boss.x - beforeX, boss.y - beforeY);
      assert.ok(moved < 9 * frameMs / 16.667 + 1,
        `Boss 瞬移了 ${moved.toFixed(1)}px（${boss.hellState}）`);
      assert.ok([boss.x, boss.y].every(Number.isFinite), "Boss 坐标必须有限");

      if (state.hellSin < 32) {
        if (boss.damageTakenMul > 1) sawLowSinBonus = true;
        if (boss.hellAttack === "hellfireVerdict" && boss.hellState === "warn") sawVerdictWhileLowSin = true;
      }

      if (boss.hellAttack) attacks.add(boss.hellAttack);
      states.add(boss.hellState);

      if (boss.hellState === "warn") {
        assert.ok(boss.hellWarnMs >= 800 && boss.hellWarnMs <= 1600,
          `预警时长越界：${boss.hellWarnMs}`);
        if (lastState !== "warn") {
          warnAnchor = { x: boss.x, y: boss.y };
          warnMsAtStart = boss.hellWarnMs;
        } else {
          assert.equal(boss.hellWarnMs, warnMsAtStart, "同一次预警的时长被改动");
          assert.equal(boss.x, warnAnchor.x, "Boss 在预警期间移动了");
          assert.equal(boss.y, warnAnchor.y, "Boss 在预警期间移动了");
        }
      }
      lastState = boss.hellState;

      state.enemyBullets.forEach((b) => { b.x += b.vx || 0; b.y += b.vy || 0; });
      state.enemyBullets = state.enemyBullets.filter(
        (b) => b.x > -60 && b.x < WIDTH + 60 && b.y > -60 && b.y < HEIGHT + 60);
    }

    ["sentence", "hellfireVerdict", "avici"].forEach((a) => {
      assert.ok(attacks.has(a), `${frameMs}ms 帧长下没轮到招式 ${a}`);
    });
    assert.ok(states.has("warn"), "必须有预警相");
    assert.ok(states.has("idle"), "招式之间必须回到 idle，否则是死锁");
    assert.ok(sawLowSinBonus, "低罪时阎罗应当承伤加成");
    assert.equal(sawVerdictWhileLowSin, false, "低罪时不该解锁业火判决");
  }
});

test("无间：两个安全格中至少一个与玩家当前格相邻 —— 拖得再慢也有解", () => {
  const h = harness();
  const boss = h.enemies.createBoss("yama", 10);
  boss.bossVariant = "yama";
  boss.entered = true;
  boss.y = 90;

  // 遍历玩家可能站的每一格，各抽样多次
  for (let pc = 0; pc < 3; pc += 1) {
    for (let pr = 0; pr < 4; pr += 1) {
      for (let n = 0; n < 40; n += 1) {
        const state = hellState(h);
        state.player.x = (pc + 0.5) * (WIDTH / 3) - 16;
        state.player.y = (pr + 0.5) * (HEIGHT / 4) - 18;
        state.hellSin = 100;
        state.enemies = [boss];
        boss.hellState = "idle";
        boss.hellTimer = 0;
        boss.hellCooldowns = { sentence: 0, hellfireVerdict: 0, avici: 0 };
        h.updateBoss(boss, 16, state, () => {}, () => {});

        assert.equal(boss.hellAttack, "avici", "满罪必出无间");
        const safe = state.hellAviciSafe;
        assert.ok(Array.isArray(safe) && safe.length === 2, "无间有两个安全格");
        const adjacent = safe.some((s) => Math.abs(s.c - pc) <= 1 && Math.abs(s.r - pr) <= 1);
        assert.ok(adjacent, `玩家在 (${pc},${pr}) 时没有相邻安全格：${JSON.stringify(safe)}`);
        // 两个安全格不能是同一格，否则实际只有一格安全
        assert.ok(safe[0].c !== safe[1].c || safe[0].r !== safe[1].r, "两个安全格不能重合");
      }
    }
  }
});

test("锁刑：缺口每一行都够宽、墙铺满整屏、连续两道之间来得及横移", () => {
  // 这条测的是**可解性**，不是外观。三个都不能破：
  //   ① 缺口 ≥ 45px（已发货 Boss 走廊的下限，玩家宽 32px）
  //   ② 每道墙从屏幕左缘铺到右缘 —— 不能靠贴边绕过去
  //   ③ 缺口的横移距离 ≤ 两道墙的间隔能拖到的距离（保守按 700px/s）
  const DRAG = 700, FLOOR = 45, W2 = 390;

  /** 把一道墙的子弹沿各自速度推到 rowY，量它们在 x 上留下的最大空隙 */
  function gapAtRow(bullets, rowY) {
    const xs = [];
    bullets.forEach((b) => {
      if (!(b.vy > 0)) return;
      const t = (rowY - (b.y + b.h / 2)) / b.vy;
      if (t < 0) return;
      xs.push(b.x + b.w / 2 + b.vx * t);
    });
    xs.sort((a, c) => a - c);
    let best = 0, at = 0;
    for (let i = 0; i < xs.length - 1; i += 1) {
      const d = xs[i + 1] - xs[i];
      if (d > best) { best = d; at = (xs[i] + xs[i + 1]) / 2; }
    }
    return { width: best - 12, at, left: xs[0], right: xs[xs.length - 1] };
  }

  for (const phase of [1, 2]) {
    const h = harness();
    const boss = h.enemies.createBoss("yama", 10);
    boss.bossVariant = "yama";
    boss.entered = true;
    boss.x = W2 / 2 - boss.w / 2;
    boss.y = 90;
    boss.hellPhase = phase;
    const state = hellState(h);
    state.enemies = [boss];

    const walls = [];
    for (let t = 0; t < 12000 && walls.length < (phase === 2 ? 6 : 4); t += 16) {
      const before = state.enemyBullets.length;
      h.updateBoss(boss, 16, state, (b) => state.enemyBullets.push(b), () => {});
      const made = state.enemyBullets.slice(before);
      if (made.length > 8) walls.push({ t, made });
    }
    assert.ok(walls.length >= (phase === 2 ? 6 : 4), `${phase} 阶段应铺出全部墙，实际 ${walls.length}`);

    walls.forEach((wall, i) => {
      [500, 640, 700, 780].forEach((row) => {
        const g = gapAtRow(wall.made, row);
        assert.ok(g.width >= FLOOR,
          `${phase} 阶段第 ${i + 1} 道墙在 y=${row} 的缺口只有 ${g.width.toFixed(0)}px（下限 ${FLOOR}px）`);
      });
      const g = gapAtRow(wall.made, 700);
      assert.ok(g.left <= 0 && g.right >= W2,
        `${phase} 阶段第 ${i + 1} 道墙没铺满整屏（${g.left.toFixed(0)}→${g.right.toFixed(0)}），玩家能贴边绕过去`);
    });

    for (let i = 1; i < walls.length; i += 1) {
      const dtMs = walls[i].t - walls[i - 1].t;
      const dx = Math.abs(gapAtRow(walls[i].made, 700).at - gapAtRow(walls[i - 1].made, 700).at);
      const need = (dx / DRAG) * 1000;
      assert.ok(need <= dtMs,
        `${phase} 阶段第 ${i}→${i + 1} 道：缺口横移 ${dx.toFixed(0)}px 需 ${need.toFixed(0)}ms，`
        + `但两道墙只隔 ${dtMs}ms —— 无解`);
    }
  }
});
