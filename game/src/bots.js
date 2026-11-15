// Bots: 5v5 voxel teammates and enemies for JADE PASS.
// createBots(scene, world, rng) -> { list, spawn, step, reset, alive, damage, hitMeshes, positions }
//
// RETURN CONTRACT (step): step(dt, ctx) returns an array of shot events, one per bullet
// fired by a bot this step:
//   { from: Vector3, to: Vector3, hit: bool, victim: 'player' | bot | null, part: 'head' | 'body' | null, damage: number }
// plus `shooter: bot` (extra field, for killfeed credit in main.js).
// main.js owns the consequences: it draws tracers from `from` to `to`, applies damage to
// the player (player.damage) or to a bot (bots.damage), and feeds kills to rounds.onKill.
// Bots never damage anything themselves; they only report shots.
//
// ctx shape step() may rely on:
//   { playerPos: Vector3, playerAlive: bool, playerCrouching: bool, playerTeam: 'attack'|'defend',
//     playerHitMesh: Mesh | null,            // optional; see "player hit" note below
//     plant: { state: 'none'|'planting'|'planted'|'defused'|'exploded', site: 'A'|'B'|null, t: number },
//     time: number, events: [{ type: 'shot', pos: Vector3 }],   // hearing bus, this step
//     smokeSpheres: [{ center: Vector3, radius: number, ttl: number }],  // grenades.smokeSpheres
//     isBlinded: (agent) => bool,             // grenades.isBlinded, passed through by main
//     radio: (text) => void, hud: null }
// Plant/defuse completion is reported through optional ctx callbacks (main wires them to
// rounds): ctx.onPlantDone(site, bot), ctx.onDefuseDone(site, bot). While a bot channels,
// bot.planting / bot.defusing is true and bot.plantProgress / bot.defuseProgress is 0..1,
// so main can drive the HUD bar and rounds progress.
//
// Player-hit note: if ctx.playerHitMesh is provided, bot bullets raycast against it like
// any other hit mesh. If it is null (player.js exposes no hit mesh), a bot bullet that has
// clear LOS and passes within 0.35 m of the player's chest point at the player's distance
// counts as a body hit (within 0.18 m of the head point counts as a head hit).
//
// Brain: 'plan' -> 'route' -> 'hold' -> 'engage' -> 'rotate' -> 'plant' / 'defuse'.
// Vision: LOS raycast vs world.shootables, smoke spheres opaque, FOV 100 deg, range 45 m
// (x0.75 vs a crouched target). Reaction delay 0.25-0.45 s on first sight. Fire in bursts
// of 3-5 with 0.4 s pauses. Hearing: shot events within 25 m pull 'route'/'hold' bots to
// investigate the shot's nearest waypoint, then they resume their plan.
// Death: the group tips over, sinks after 3 s, hit meshes leave hitMeshes at once.
import * as THREE from 'three';

const WALK_SPEED = 3.8;
const VISION_RANGE = 45;
const FOV_COS = Math.cos((100 / 2) * (Math.PI / 180));
const HEAR_RANGE = 25;
const BURST_PAUSE = 0.4;
const PLANT_TIME = 4;
const DEFUSE_TIME = 5;
const DEFUSE_TIME_KIT = 2.5;
const EYE_HEIGHT = 1.5;
const MUZZLE_HEIGHT = 1.35;

const TEAM_COLOR = { attack: 0x2fa8a0, defend: 0xd84a2f };
const SKIN = 0xd9a986;
const DARK = 0x2b2f2b;

const BOT_WEAPONS = {
  typhoon: { damage: 27, rate: 0.115, range: 90 },
  cicada: { damage: 19, rate: 0.085, range: 60 },
  koi: { damage: 34, rate: 0.18, range: 50 },
};

const ATTACK_PLANS = ['A LONG', 'B BRIDGE', 'MID SPLIT'];
const DEFEND_PLANS = ['2A 2B 1MID', '3A 1B 1MID', '1A 3B 1MID'];

// Route tables: waypoint-name sequences from spawn to objective. All attack
// routes leave the yard through a spawn-wall gate (gateW / gateM / gateE).
const ATTACK_ROUTES = {
  'A LONG': ['spawnA', 'southYard', 'yardW', 'gateW', 'aLong', 'aSite', 'aSteps'],
  'B BRIDGE': ['spawnA', 'southYard', 'yardE', 'gateE', 'bLong', 'bridge', 'bSite'],
  'MID SPLIT': ['spawnA', 'southYard', 'gateM', 'mid', 'court', 'aSite', 'aSteps'],
};
const ATTACK_HOLD = { 'A LONG': 'aSite', 'B BRIDGE': 'bSite', 'MID SPLIT': 'aSite' };
// Defenders: per-bot hold waypoints for each plan (index = bot order in spawn list).
const DEFEND_HOLDS = {
  '2A 2B 1MID': ['aHold', 'aSite', 'bHold', 'bSite', 'midHold'],
  '3A 1B 1MID': ['aHold', 'aSite', 'court', 'bSite', 'midHold'],
  '1A 3B 1MID': ['aSite', 'bHold', 'bSite', 'bridge', 'midHold'],
};

const RADIO_PLAN = {
  'A LONG': 'Going A long, three up, two through Mid',
  'B BRIDGE': 'Pushing B bridge, watch the river',
  'MID SPLIT': 'Splitting Mid, carrier with the main group',
  '2A 2B 1MID': 'Two on A, two on B, one watching Mid',
  '3A 1B 1MID': 'Three holding A, one on B, one Mid',
  '1A 3B 1MID': 'One on A, three on B, one Mid',
};

export function createBots(scene, world, rng) {
  const list = [];
  const hitMeshes = [];
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const tmpD = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  function makeNameSprite(name, team) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const ctx2d = canvas.getContext('2d');
    ctx2d.fillStyle = team === 'attack' ? '#2fa8a0' : '#d84a2f';
    ctx2d.fillRect(0, 0, 128, 32);
    ctx2d.fillStyle = '#eef2e4';
    ctx2d.font = 'bold 20px monospace';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(name, 64, 17);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
    sprite.scale.set(1.5, 0.375, 1);
    sprite.position.y = 2.05;
    return sprite;
  }

  function buildBody(bot) {
    const teamMat = new THREE.MeshLambertMaterial({ color: TEAM_COLOR[bot.team] });
    const skinMat = new THREE.MeshLambertMaterial({ color: SKIN });
    const darkMat = new THREE.MeshLambertMaterial({ color: DARK });
    const group = new THREE.Group();

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.28), teamMat);
    torso.position.y = 1.05;
    torso.userData = { agent: bot, part: 'body' };
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skinMat);
    head.position.y = 1.55;
    head.userData = { agent: bot, part: 'head' };
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.2), darkMat);
    legL.position.set(-0.14, 0.375, 0);
    legL.userData = { agent: bot, part: 'body' };
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.2), darkMat);
    legR.position.set(0.14, 0.375, 0);
    legR.userData = { agent: bot, part: 'body' };
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.15), teamMat);
    armL.position.set(-0.33, 1.05, 0);
    armL.userData = { agent: bot, part: 'body' };
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.15), teamMat);
    armR.position.set(0.33, 1.05, 0.05);
    armR.userData = { agent: bot, part: 'body' };
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.55), darkMat);
    gun.position.set(0.2, 1.3, -0.25);
    gun.userData = { agent: bot, part: 'body' };
    const sprite = makeNameSprite(bot.name, bot.team);
    group.add(torso, head, legL, legR, armL, armR, gun, sprite);
    group.traverse((child) => { child.castShadow = true; });
    scene.add(group);
    bot.group = group;
    bot.headMesh = head;
    bot.meshes = [torso, head, legL, legR, armL, armR, gun];
    for (const m of bot.meshes) hitMeshes.push(m);
  }

  function pickWeapon(team) {
    if (team === 'attack') return rng() < 0.7 ? 'typhoon' : 'cicada';
    return rng() < 0.6 ? 'typhoon' : 'koi';
  }

  function bfsPath(from, to) {
    if (from === to) return [to];
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift();
      const neighbours = world.edges.get(cur) || [];
      for (const next of neighbours) {
        if (prev.has(next)) continue;
        prev.set(next, cur);
        if (next === to) {
          const path = [to];
          let node = cur;
          while (node !== null) { path.unshift(node); node = prev.get(node); }
          return path;
        }
        queue.push(next);
      }
    }
    return [to];
  }

  function nearestWaypoint(pos) {
    let best = null;
    let bestDist = Infinity;
    for (const [name, wp] of world.waypoints) {
      const d = (wp.x - pos.x) ** 2 + (wp.z - pos.z) ** 2;
      if (d < bestDist) { bestDist = d; best = name; }
    }
    return best;
  }

  function setPath(bot, names) {
    bot.path = names.map((n) => world.waypoints.get(n)).filter(Boolean);
    bot.pathIndex = 0;
    bot.peekTimer = 0;
  }

  function pathTo(bot, targetName) {
    const from = nearestWaypoint(bot.group.position);
    setPath(bot, bfsPath(from, targetName));
  }

  function spawn(side, names, isPlayerTeam) {
    const team = side === 'attack' ? 'attack' : 'defend';
    const plan = team === 'attack'
      ? ATTACK_PLANS[Math.floor(rng() * ATTACK_PLANS.length)]
      : DEFEND_PLANS[Math.floor(rng() * DEFEND_PLANS.length)];
    const spawnPoints = side === 'attack' ? world.spawns.attack : world.spawns.defend;
    const created = [];
    names.forEach((name, i) => {
      const bot = {
        name,
        team,
        isPlayerTeam,
        hp: 100,
        alive: true,
        // Face the sites: attackers look north (-z, yaw 0), defenders south (yaw PI).
        yaw: side === 'attack' ? 0 : Math.PI,
        state: 'plan',
        plan,
        weaponId: pickWeapon(team),
        kit: team === 'defend' && rng() < 0.5,
        carrier: false,
        planting: false,
        plantProgress: 0,
        plantSite: null,
        defusing: false,
        defuseProgress: 0,
        path: [],
        pathIndex: 0,
        peekTimer: 0,
        holdWp: null,
        target: null,
        targetIsPlayer: false,
        reactionT: 0,
        burstLeft: 0,
        fireTimer: 0,
        pauseTimer: 0,
        visionTimer: rng() * 0.1,
        deathT: 0,
        announced: false,
        calloutT: 0,
        investigate: null,
        sweepDir: 1,
        strafeDir: rng() < 0.5 ? 1 : -1,
        strafeT: 0,
      };
      bot.weapon = BOT_WEAPONS[bot.weaponId];
      const sp = spawnPoints[i % spawnPoints.length];
      buildBody(bot);
      bot.group.position.set(sp.x + (rng() * 2 - 1) * 0.6, 0, sp.z + (rng() * 2 - 1) * 0.6);
      bot.group.rotation.y = bot.yaw;
      // Plan assignment.
      if (team === 'attack') {
        const route = ATTACK_ROUTES[plan];
        if (plan === 'MID SPLIT' && i === 3) {
          // The lurker holds Mid instead of pushing the site.
          bot.holdWp = 'midHold';
          setPath(bot, ['spawnA', 'southYard', 'gateM', 'mid', 'midHold']);
        } else {
          bot.holdWp = ATTACK_HOLD[plan];
          setPath(bot, route);
        }
        if (i === 0) bot.carrier = true; // carrier follows the main group
      } else {
        bot.holdWp = DEFEND_HOLDS[plan][i % DEFEND_HOLDS[plan].length];
        pathTo(bot, bot.holdWp);
      }
      list.push(bot);
      created.push(bot);
    });
    return created;
  }

  function smokeBlocks(a, b) {
    if (!stepCtx.smokeSpheres) return false;
    for (const s of stepCtx.smokeSpheres) {
      if (s.ttl <= 0) continue;
      // Segment-sphere test.
      tmpA.copy(b).sub(a);
      tmpB.copy(s.center).sub(a);
      const lenSq = tmpA.lengthSq();
      if (lenSq === 0) continue;
      let t = tmpB.dot(tmpA) / lenSq;
      t = Math.max(0, Math.min(1, t));
      tmpC.copy(a).addScaledVector(tmpA, t);
      if (tmpC.distanceToSquared(s.center) < s.radius * s.radius) return true;
    }
    return false;
  }

  let stepCtx = null;

  function canSee(bot, targetPos, targetCrouching) {
    tmpA.copy(bot.group.position);
    tmpA.y += EYE_HEIGHT;
    tmpB.copy(targetPos);
    tmpB.y += 1.3;
    const dist = tmpA.distanceTo(tmpB);
    const range = VISION_RANGE * (targetCrouching ? 0.75 : 1);
    if (dist > range) return false;
    tmpC.copy(tmpB).sub(tmpA).normalize();
    tmpDir.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    if (tmpC.dot(tmpDir) < FOV_COS) return false;
    if (smokeBlocks(tmpA, tmpB)) return false;
    raycaster.set(tmpA, tmpC);
    raycaster.far = dist;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  function acquireTarget(bot) {
    bot.target = null;
    bot.targetIsPlayer = false;
    // The player, if alive and on the enemy team (ctx.playerTeam is 'attack' in
    // the first half, 'defend' after the side swap; fall back to isPlayerTeam).
    const playerTeam = stepCtx.playerTeam || (bot.isPlayerTeam ? bot.team : (bot.team === 'attack' ? 'defend' : 'attack'));
    if (stepCtx.playerAlive && bot.team !== playerTeam) {
      if (canSee(bot, stepCtx.playerPos, stepCtx.playerCrouching)) {
        bot.target = 'player';
        bot.targetIsPlayer = true;
        return true;
      }
    }
    // Enemy bots.
    let best = null;
    let bestDist = Infinity;
    for (const other of list) {
      if (!other.alive || other.team === bot.team) continue;
      if (other.isPlayerTeam === bot.isPlayerTeam) continue;
      const d = bot.group.position.distanceToSquared(other.group.position);
      if (d >= bestDist) continue;
      tmpD.copy(other.group.position);
      if (canSee(bot, tmpD, false)) {
        best = other;
        bestDist = d;
      }
    }
    if (best) {
      bot.target = best;
      bot.targetIsPlayer = false;
      return true;
    }
    return false;
  }

  function muzzlePos(bot, out) {
    out.copy(bot.group.position);
    out.y += MUZZLE_HEIGHT;
    out.x += -Math.sin(bot.yaw) * 0.45;
    out.z += -Math.cos(bot.yaw) * 0.45;
    return out;
  }

  const rayTargets = []; // reused per shot; no allocation in the fire loop
  function fireAt(bot, shots) {
    const from = muzzlePos(bot, new THREE.Vector3());
    let targetPoint;
    let targetIsPlayer = bot.targetIsPlayer;
    if (targetIsPlayer) {
      targetPoint = tmpA.copy(stepCtx.playerPos);
      targetPoint.y += 1.25;
    } else {
      targetPoint = tmpA.copy(bot.target.group.position);
      targetPoint.y += 1.3;
    }
    // Spread grows with distance; headshots need a tight ray.
    const dist = from.distanceTo(targetPoint);
    const spread = 0.012 + dist * 0.0009;
    tmpDir.copy(targetPoint).sub(from).normalize();
    tmpDir.x += (rng() * 2 - 1) * spread;
    tmpDir.y += (rng() * 2 - 1) * spread;
    tmpDir.z += (rng() * 2 - 1) * spread;
    tmpDir.normalize();
    const targets = rayTargets;
    targets.length = 0;
    for (const m of world.shootables) targets.push(m);
    if (targetIsPlayer) {
      if (stepCtx.playerHitMesh) targets.push(stepCtx.playerHitMesh);
    } else {
      for (const m of bot.target.meshes) targets.push(m);
    }
    raycaster.set(from, tmpDir);
    raycaster.far = bot.weapon.range;
    const hits = raycaster.intersectObjects(targets, false);
    const to = new THREE.Vector3();
    let hit = false;
    let victim = null;
    let part = null;
    let damage = 0;
    if (hits.length > 0) {
      const first = hits[0];
      to.copy(first.point);
      const ud = first.object.userData;
      if (ud && ud.agent) {
        hit = true;
        victim = ud.agent;
        part = ud.part || 'body';
        damage = bot.weapon.damage * (part === 'head' ? 4 : 1);
      }
    } else {
      to.copy(from).addScaledVector(tmpDir, Math.min(dist + 2, bot.weapon.range));
    }
    // Fallback when the player has no hit mesh: proximity of the ray to the chest/head.
    if (targetIsPlayer && !hit && !stepCtx.playerHitMesh) {
      tmpB.copy(stepCtx.playerPos);
      tmpB.y += 1.25;
      tmpC.copy(tmpB).sub(from);
      const along = tmpC.dot(tmpDir);
      if (along > 0 && along < bot.weapon.range) {
        tmpD.copy(from).addScaledVector(tmpDir, along);
        const dChest = tmpD.distanceTo(tmpB);
        tmpB.y = stepCtx.playerPos.y + 1.55;
        const dHead = tmpD.distanceTo(tmpB);
        if (dHead < 0.18) {
          hit = true; victim = 'player'; part = 'head'; damage = bot.weapon.damage * 4;
          to.copy(tmpD);
        } else if (dChest < 0.35) {
          hit = true; victim = 'player'; part = 'body'; damage = bot.weapon.damage;
          to.copy(tmpD);
        }
      }
    }
    if (targetIsPlayer && hit && victim === null) victim = 'player';
    shots.push({ from, to, hit, victim, part, damage, shooter: bot });
  }

  function moveAlongPath(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    if (bot.peekTimer > 0) {
      bot.peekTimer -= dt;
      return false;
    }
    const wp = bot.path[bot.pathIndex];
    tmpA.copy(wp);
    tmpA.y = 0;
    tmpB.copy(bot.group.position);
    tmpB.y = 0;
    const d = tmpA.sub(tmpB);
    const dist = d.length();
    if (dist < 0.25) {
      bot.pathIndex += 1;
      // Stop-and-peek at corners (not at the final waypoint).
      if (bot.pathIndex < bot.path.length) bot.peekTimer = 0.35;
      return bot.pathIndex >= bot.path.length;
    }
    d.normalize();
    bot.group.position.addScaledVector(d, WALK_SPEED * dt);
    bot.yaw = Math.atan2(-d.x, -d.z);
    bot.group.rotation.y = bot.yaw;
    return false;
  }

  function faceTarget(bot, dt) {
    let tx;
    let tz;
    if (bot.targetIsPlayer) {
      tx = stepCtx.playerPos.x;
      tz = stepCtx.playerPos.z;
    } else {
      tx = bot.target.group.position.x;
      tz = bot.target.group.position.z;
    }
    const want = Math.atan2(-(tx - bot.group.position.x), -(tz - bot.group.position.z));
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-6 * dt, Math.min(6 * dt, diff));
    bot.group.rotation.y = bot.yaw;
  }

  function stepBot(bot, dt, shots) {
    if (!bot.alive) {
      bot.deathT += dt;
      if (bot.deathT > 3 && bot.group.position.y > -1.2) {
        bot.group.position.y -= dt * 0.25;
      }
      return;
    }
    bot.calloutT = Math.max(0, bot.calloutT - dt);
    const blinded = stepCtx.isBlinded ? stepCtx.isBlinded(bot) : false;

    // Announce the team plan once, on the first step after spawn.
    if (!bot.announced) {
      bot.announced = true;
      if (stepCtx.radio) stepCtx.radio(`${bot.name}: ${RADIO_PLAN[bot.plan]}`);
    }

    // Hearing: shot events within 25 m pull route/hold bots to investigate.
    if (!blinded && stepCtx.events) {
      for (const ev of stepCtx.events) {
        if (ev.type !== 'shot' || !ev.pos) continue;
        if (bot.group.position.distanceTo(ev.pos) > HEAR_RANGE) continue;
        if (bot.state !== 'route' && bot.state !== 'hold') continue;
        if (bot.investigate) continue;
        bot.investigate = { resumeState: bot.state, resumeWp: bot.holdWp };
        pathTo(bot, nearestWaypoint(ev.pos));
        bot.state = 'route';
        break;
      }
    }

    // Plant / defuse channels interrupt everything else.
    if (bot.planting) {
      bot.plantProgress += dt / PLANT_TIME;
      if (bot.plantProgress >= 1) {
        bot.planting = false;
        bot.state = 'hold';
        if (stepCtx.onPlantDone) stepCtx.onPlantDone(bot.plantSite, bot);
      }
      return;
    }
    if (bot.defusing) {
      const total = bot.kit ? DEFUSE_TIME_KIT : DEFUSE_TIME;
      bot.defuseProgress += dt / total;
      if (bot.defuseProgress >= 1) {
        bot.defusing = false;
        bot.state = 'hold';
        if (stepCtx.onDefuseDone) stepCtx.onDefuseDone(stepCtx.plant.site, bot);
      }
      return;
    }

    // Rotate on plant: defenders head for the planted site, attackers hold it.
    if (stepCtx.plant && stepCtx.plant.state === 'planted' && bot.state !== 'rotate' && bot.state !== 'engage') {
      const site = stepCtx.plant.site;
      if (bot.team === 'defend') {
        bot.state = 'rotate';
        pathTo(bot, site === 'A' ? 'aSite' : 'bSite');
      } else {
        bot.state = 'rotate';
        pathTo(bot, site === 'A' ? 'aSite' : 'bSite');
      }
    }

    // Vision runs on a short throttle so 9 bots do not raycast every tick.
    // Freeze time is quiet: bots move to their holds but never spot, call out
    // or fire before the round goes live.
    bot.visionTimer -= dt;
    if (bot.visionTimer <= 0) {
      bot.visionTimer = 0.1;
      if (!blinded && stepCtx.phase === 'live') {
        const hadTarget = bot.target !== null;
        const seen = acquireTarget(bot);
        if (seen && !hadTarget) {
          bot.reactionT = 0.25 + rng() * 0.2;
          bot.state = 'engage';
          if (bot.calloutT <= 0) {
            bot.calloutT = 4;
            const where = bot.targetIsPlayer ? 'Bamboo Walk' : 'contact';
            if (stepCtx.radio) stepCtx.radio(`${bot.name}: Contact, ${where} — enemy spotted`);
          }
        } else if (!seen && bot.state === 'engage') {
          bot.target = null;
          bot.state = bot.holdWp ? 'hold' : 'route';
        }
      } else {
        bot.target = null;
        if (bot.state === 'engage') bot.state = 'hold';
      }
    }

    switch (bot.state) {
      case 'plan':
        bot.state = 'route';
        break;
      case 'route': {
        const arrived = moveAlongPath(bot, dt);
        if (arrived) {
          if (bot.investigate) {
            const resume = bot.investigate;
            bot.investigate = null;
            if (resume.resumeWp) pathTo(bot, resume.resumeWp);
            bot.state = resume.resumeState === 'hold' ? 'hold' : 'route';
          } else if (bot.holdWp) {
            bot.state = 'hold';
          } else {
            bot.state = 'hold';
          }
        }
        break;
      }
      case 'hold': {
        // Yaw sweep +-40 deg.
        bot.yaw += bot.sweepDir * dt * 0.7;
        const base = bot.team === 'attack' ? Math.PI : 0;
        if (bot.yaw > base + 0.7) bot.sweepDir = -1;
        if (bot.yaw < base - 0.7) bot.sweepDir = 1;
        bot.group.rotation.y = bot.yaw;
        // Carrier plants when it reaches the site and the charge is not planted.
        if (bot.carrier && stepCtx.plant && stepCtx.plant.state === 'none' && bot.holdWp) {
          const site = bot.holdWp === 'bSite' ? 'B' : 'A';
          const siteCenter = world.sites[site].center;
          if (bot.group.position.distanceTo(siteCenter) < world.sites[site].radius + 0.5) {
            bot.planting = true;
            bot.plantProgress = 0;
            bot.plantSite = site;
            bot.state = 'plant';
            if (stepCtx.radio) stepCtx.radio(`${bot.name}: Planting the charge, cover me`);
          }
        }
        break;
      }
      case 'rotate': {
        const arrived = moveAlongPath(bot, dt);
        if (arrived) {
          if (stepCtx.plant && stepCtx.plant.state === 'planted' && bot.team === 'defend') {
            bot.defusing = true;
            bot.defuseProgress = 0;
            bot.state = 'defuse';
            if (stepCtx.radio) stepCtx.radio(`${bot.name}: Defusing the charge`);
          } else {
            bot.state = 'hold';
          }
        }
        break;
      }
      case 'engage': {
        if (!bot.target || (bot.target !== 'player' && !bot.target.alive)) {
          bot.target = null;
          bot.state = 'hold';
          break;
        }
        faceTarget(bot, dt);
        // Strafe-peek: sidestep while firing.
        bot.strafeT -= dt;
        if (bot.strafeT <= 0) {
          bot.strafeT = 0.6 + rng() * 0.6;
          bot.strafeDir = rng() < 0.5 ? 1 : -1;
        }
        tmpA.set(Math.cos(bot.yaw) * bot.strafeDir, 0, -Math.sin(bot.yaw) * bot.strafeDir);
        bot.group.position.addScaledVector(tmpA, 1.4 * dt);
        if (bot.reactionT > 0) {
          bot.reactionT -= dt;
          break;
        }
        if (bot.pauseTimer > 0) {
          bot.pauseTimer -= dt;
          break;
        }
        if (bot.burstLeft <= 0) {
          bot.burstLeft = 3 + Math.floor(rng() * 3);
          bot.fireTimer = 0;
        }
        bot.fireTimer -= dt;
        if (bot.fireTimer <= 0) {
          bot.fireTimer = bot.weapon.rate;
          bot.burstLeft -= 1;
          fireAt(bot, shots);
          if (bot.burstLeft <= 0) bot.pauseTimer = BURST_PAUSE;
        }
        break;
      }
      default:
        bot.state = 'hold';
        break;
    }
  }

  function step(dt, ctx) {
    stepCtx = ctx;
    const shots = [];
    for (const bot of list) stepBot(bot, dt, shots);
    stepCtx = null;
    return shots;
  }

  function reset() {
    for (const bot of list) {
      scene.remove(bot.group);
      for (const m of bot.meshes) {
        m.geometry.dispose();
        m.material.dispose();
      }
    }
    list.length = 0;
    hitMeshes.length = 0;
  }

  function alive(team) {
    let n = 0;
    for (const bot of list) if (bot.alive && (!team || bot.team === team)) n += 1;
    return n;
  }

  function damage(bot, amount, part) {
    if (!bot || !bot.alive) return false;
    bot.hp -= amount * (part === 'head' ? 1 : 1); // head multiplier already applied by the shooter
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.target = null;
      bot.planting = false;
      bot.defusing = false;
      bot.deathT = 0;
      bot.group.rotation.z = rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      // Leave the hit meshes at once so no more bullets register on a corpse.
      for (const m of bot.meshes) {
        const idx = hitMeshes.indexOf(m);
        if (idx !== -1) hitMeshes.splice(idx, 1);
      }
      return true;
    }
    return false;
  }

  function positions() {
    return list.map((bot) => ({
      name: bot.name,
      team: bot.team,
      isPlayerTeam: bot.isPlayerTeam,
      x: bot.group.position.x,
      z: bot.group.position.z,
      alive: bot.alive,
    }));
  }

  return { list, spawn, step, reset, alive, damage, hitMeshes, positions };
}
