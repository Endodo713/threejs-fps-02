// JADE PASS — boot, fixed-step loop, player shooting, bot-shot wiring, plant/defuse,
// and the deterministic ?shot= modes. Imports in spec order.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createGrenades } from './grenades.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createEffects } from './effects.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const MONSOON_NAMES = ['Rin', 'Sora', 'Hana', 'Kaito'];
const JADE_NAMES = ['Ren', 'Yuki', 'Aoi', 'Haru', 'Mika'];
const MAX_ROUNDS = 12;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

// --- Renderer / scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 25, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

// --- Modules ----------------------------------------------------------------
const world = createWorld(scene);
const player = createPlayer(world.colliders);
const weapon = createWeapon(camera);
const grenades = createGrenades(scene, world, random);
const bots = createBots(scene, world, random);
const effects = createEffects(scene);
const hud = createHud();
hud.setShotMode(!!shot);
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const muzzleWorld = new THREE.Vector3();

const body = player.state;
const markerHoldMs = shot ? 4000 : 90;

// --- Rounds bus ---------------------------------------------------------------
const bus = {
  emit(type, data) {
    if (type === 'roundEnd') {
      const attackWon = data.winner === 'attack';
      const title = data.reason === 'match'
        ? (attackWon ? 'MONSOON WINS THE MATCH' : 'JADE WATCH WINS THE MATCH')
        : (attackWon ? 'MONSOON WINS THE ROUND' : 'JADE WATCH WINS THE ROUND');
      hud.showBanner(title, data.reason || '');
      if (data.reason === 'match') {
        hud.showOverlay('end', { scoreA: rounds.state.scoreA, scoreB: rounds.state.scoreB, winner: data.winner });
        if (document.pointerLockElement) document.exitPointerLock();
      }
    } else if (type === 'kill') {
      hud.killfeed(`${data.killer}  ✕  ${data.victim}${data.headshot ? '  (headshot)' : ''}`);
    } else if (type === 'plant') {
      hud.setSiteBanner(`SPARK PLANTED — Site ${data.site}, 40 seconds on the fuse`);
    } else if (type === 'defuse') {
      hud.setSiteBanner(`CHARGE DEFUSED — Site ${data.site}`);
    } else if (type === 'radio') {
      hud.radio(data.text);
    }
  },
};
const rounds = createRounds(bus, random);

// --- Match state ---------------------------------------------------------------
let elapsed = 0;
let frozen = false;
let started = false;
let playerAlive = true;
let accumulator = 0;
let lastTime = performance.now();
let lastRound = 0;
let lastPhase = '';
let selectedGrenade = null; // 'thunder' | 'mist' | 'dawn' | null
let prevFiring = false;
let prevThrowKey = false;
let prevBuyKey = false;
const hearing = []; // shot events { type: 'shot', pos } collected since the last fixed step
const shootables = world.shootables; // bots.hitMeshes are appended per raycast via a reused array
const rayTargets = [];

function playerTeam() {
  return rounds.state.playerTeam;
}

function spawnPointFor(team) {
  const list = team === 'attack' ? world.spawns.attack : world.spawns.defend;
  return list[0];
}

function setupRound() {
  bots.reset();
  effects.reset();
  // Teams: player + 4 friendly MONSOON bots vs 5 JADE WATCH bots while attacking;
  // after the swap the player defends with the JADE WATCH names on their side.
  const attackNames = MONSOON_NAMES;
  const defendNames = JADE_NAMES;
  if (playerTeam() === 'attack') {
    bots.spawn('attack', attackNames, true);
    bots.spawn('defend', defendNames, false);
  } else {
    bots.spawn('defend', defendNames, true);
    bots.spawn('attack', attackNames, false);
  }
  // Respawn the player at their side's spawn, facing the sites: attackers look
  // north (-z, yaw 0) from the south spawn, defenders look south (yaw PI).
  const sp = spawnPointFor(playerTeam());
  body.position.set(sp.x, 0, sp.z);
  body.velocity.set(0, 0, 0);
  body.yaw = playerTeam() === 'attack' ? 0 : Math.PI;
  body.pitch = 0;
  body.hp = 100;
  if (player.state.armour !== undefined) player.state.armour = rounds.state.loadout.armour || 0;
  playerAlive = true;
  // Carrier: one random alive attacker (may be the player).
  const candidates = [];
  if (playerTeam() === 'attack') candidates.push({ id: 'player', isPlayer: true, name: 'You', alive: true });
  for (const bot of bots.list) {
    if (bot.team === 'attack' && bot.alive) {
      candidates.push({ id: bot.name, isPlayer: false, name: bot.name, alive: true });
    }
  }
  const carrier = rounds.selectCarrier(candidates);
  hud.setChargeChip(!!carrier && carrier.id === 'player');
  // Equip the kept loadout weapon.
  weapon.select(rounds.state.loadout.weapon);
  syncHud();
  if (rounds.state.phase === 'buy') openBuyMenu();
}

function startMatch() {
  rounds.startMatch();
  lastRound = rounds.state.round;
  lastPhase = rounds.state.phase;
  setupRound();
}

function openBuyMenu() {
  const items = [];
  for (const [id, w] of Object.entries(WEAPONS)) {
    items.push({ id, name: w.name, price: w.price, kind: 'weapon' });
  }
  items.push(
    { id: 'armour', name: 'Armour', price: 650, kind: 'gear' },
    { id: 'helm', name: 'Helmet', price: 350, kind: 'gear' },
    { id: 'kit', name: 'Defuse Kit', price: 400, kind: 'gear' },
    { id: 'thunder', name: 'Thunder Grenade', price: 300, kind: 'grenade' },
    { id: 'mist', name: 'Mist Grenade', price: 300, kind: 'grenade' },
    { id: 'dawn', name: 'Dawn Grenade', price: 200, kind: 'grenade' },
  );
  hud.showBuyMenu(items, rounds.state.money, (itemId) => {
    const res = rounds.buy(itemId);
    if (res.ok) {
      if (WEAPONS[itemId]) weapon.select(itemId);
      syncHud();
      if (rounds.state.phase === 'buy') openBuyMenu();
      else hud.hideBuyMenu();
    }
    return res;
  });
}

function syncHud() {
  hud.setHealth(body.hp, player.state.armour || rounds.state.loadout.armour || 0);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.current ? weapon.current().name : '');
  hud.setMoney(rounds.state.money);
  hud.setScore(rounds.state.scoreA, rounds.state.scoreB);
  hud.setTimer(Math.max(0, Math.ceil(rounds.state.timer)), rounds.state.phase);
  hud.setRound(rounds.state.round, MAX_ROUNDS);
  // Minimap lives here (not in frame()) so deterministic ?shot= captures draw it too.
  if (typeof hud.setMinimap === 'function') {
    hud.setMinimap({
      x: body.position.x,
      z: body.position.z,
      yaw: body.yaw,
      friends: bots.positions().filter((b) => b.isPlayerTeam && b.alive),
      enemies: [],
    });
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function muzzlePosition(out) {
  camera.getWorldPosition(out);
  camera.getWorldDirection(tmpVec2);
  out.addScaledVector(tmpVec2, 0.6);
  out.y -= 0.12;
  return out;
}

// --- Player shooting ------------------------------------------------------------
function shootPlayer() {
  const w = weapon.current ? weapon.current() : WEAPONS[weapon.state.id] || WEAPONS.koi;
  if (!weapon.takeRound()) {
    if (weapon.state.reserve > 0) weapon.reload();
    return false;
  }
  const spread = weapon.spread(player.groundSpeed(), !body.onGround, body.crouching);
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  rayTargets.length = 0;
  for (const m of shootables) rayTargets.push(m);
  for (const m of bots.hitMeshes) rayTargets.push(m);
  const hits = raycaster.intersectObjects(rayTargets, false);
  const from = muzzlePosition(muzzleWorld.clone());
  const to = new THREE.Vector3();
  let hitBot = null;
  let part = null;
  if (hits.length > 0) {
    const first = hits[0];
    to.copy(first.point);
    const ud = first.object.userData;
    if (ud && ud.agent) {
      hitBot = ud.agent;
      part = ud.part || 'body';
      const damage = w.damage * (part === 'head' ? w.headMul : 1);
      const killed = bots.damage(hitBot, damage, part);
      hud.hitMarker(killed, markerHoldMs);
      if (killed) {
        rounds.onKill(playerTeam(), hitBot.team, part === 'head', true, 'You', hitBot.name, w.name);
        hud.radio(`${hitBot.name} is down`);
      }
    }
  } else {
    to.copy(camera.position).addScaledVector(direction, w.range);
  }
  effects.tracer(from, to);
  effects.muzzle(from, direction);
  if (hits.length > 0) effects.sparks(to, 6);
  hearing.push({ type: 'shot', pos: body.position.clone() });
  // NOTE: takeRound() already sets the fire-rate cooldown, recoil kick and the
  // 40 ms muzzle flash inside weapon.js — there is no separate pullTrigger().
  player.recoil(w.recoil + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, w.name);
  return true;
}

// --- Bot shots --------------------------------------------------------------------
function applyBotShots(shots) {
  for (const s of shots) {
    effects.tracer(s.from, s.to);
    if (s.from) hearing.push({ type: 'shot', pos: s.from.clone() });
    if (!s.hit || !s.victim) continue;
    if (s.victim === 'player') {
      if (!playerAlive) continue;
      player.damage(s.damage);
      hud.setHealth(body.hp, player.state.armour || 0);
      if (body.hp <= 0) {
        playerAlive = false;
        rounds.onPlayerDeath();
        hud.showBanner('YOU ARE DOWN', 'Your team fights on — respawn next round');
        if (document.pointerLockElement) document.exitPointerLock();
      }
    } else {
      const victim = s.victim;
      const killed = bots.damage(victim, s.damage, s.part);
      if (killed) {
        const shooter = s.shooter;
        rounds.onKill(shooter ? shooter.team : (victim.team === 'attack' ? 'defend' : 'attack'),
          victim.team, s.part === 'head', false,
          shooter ? shooter.name : 'enemy', victim.name, shooter ? shooter.weaponId : '');
        hud.radio(`${victim.name} is down`);
      }
    }
  }
}

// --- Plant / defuse (player) ---------------------------------------------------------
function siteNear(pos, site) {
  const c = world.sites[site].center;
  const dx = pos.x - c.x;
  const dz = pos.z - c.z;
  return Math.sqrt(dx * dx + dz * dz) <= world.sites[site].radius + 0.6;
}

function playerObjective() {
  // Returns { planting, defusing } for this step, or nulls.
  let planting = null;
  let defusing = null;
  if (!playerAlive) return { planting, defusing };
  const keys = input.state.keys;
  if (!keys.has('KeyE')) return { planting, defusing };
  const plant = rounds.state.plant;
  if (plant.state === 'none' && plant.carrier === 'player') {
    if (siteNear(body.position, 'A')) planting = { active: true, site: 'A' };
    else if (siteNear(body.position, 'B')) planting = { active: true, site: 'B' };
  } else if (plant.state === 'planted' && playerTeam() === 'defend') {
    if (siteNear(body.position, plant.site)) {
      defusing = { active: true, site: plant.site, kit: !!rounds.state.loadout.kit };
    }
  }
  return { planting, defusing };
}

// --- Fixed step -----------------------------------------------------------------------
function step(dt) {
  elapsed += dt;
  if (playerAlive) player.step(dt, input.state.keys);
  if (typeof weapon.step === 'function') weapon.step(dt);
  if (typeof world.update === 'function') world.update(dt);
  effects.step(dt);

  // Grenades age; their events (blasts, flashes) land here.
  const gEvents = grenades.step(dt, {
    time: elapsed,
    playerPos: body.position,
    playerAlive,
    playerYaw: body.yaw,
    bots: bots.list,
    hud,
  });
  for (const ev of gEvents) {
    if (ev.type === 'explode') {
      effects.sparks(ev.pos, 24);
      for (const v of ev.victims) {
        if (v.agent === 'player') {
          if (playerAlive) {
            player.damage(v.damage);
            hud.setHealth(body.hp, player.state.armour || 0);
            if (body.hp <= 0) {
              playerAlive = false;
              rounds.onPlayerDeath();
              hud.showBanner('YOU ARE DOWN', 'Your team fights on — respawn next round');
            }
          }
        } else {
          const killed = bots.damage(v.agent, v.damage, 'body');
          if (killed) {
            rounds.onKill(playerTeam(), v.agent.team, false, true, 'You', v.agent.name, 'Thunder');
            hud.radio(`${v.agent.name} is down`);
          }
        }
      }
    }
  }

  // Objective channels: player input + any bot currently channelling.
  const obj = playerObjective();
  let planting = obj.planting;
  let defusing = obj.defusing;
  for (const bot of bots.list) {
    if (!bot.alive) continue;
    if (bot.planting && !planting) planting = { active: true, site: bot.plantSite };
    if (bot.defusing && !defusing) {
      defusing = { active: true, site: rounds.state.plant.site, kit: bot.kit };
    }
  }
  const attackersAlive = bots.alive('attack') + (playerTeam() === 'attack' && playerAlive ? 1 : 0);
  const defendersAlive = bots.alive('defend') + (playerTeam() === 'defend' && playerAlive ? 1 : 0);
  rounds.step(dt, { attackersAlive, defendersAlive, planting, defusing });

  // HUD plant/defuse progress: hidden unless a channel is actually running.
  const plant = rounds.state.plant;
  if (plant.state === 'planting') hud.setPlantProgress(plant.t / 4, 'PLANTING');
  else if (plant.state === 'planted' && plant.defuseT > 0) hud.setPlantProgress(plant.defuseT / (rounds.state.loadout.kit ? 2.5 : 5), 'DEFUSING');
  else hud.setPlantProgress(null);

  // Bots: hearing bus snapshot, then clear it for the next step.
  const ctx = {
    playerPos: body.position,
    playerAlive,
    playerCrouching: body.crouching,
    playerTeam: playerTeam(),
    phase: rounds.state.phase,
    playerHitMesh: null,
    plant: { state: plant.state, site: plant.site, t: plant.t },
    time: elapsed,
    events: hearing.slice(),
    smokeSpheres: grenades.smokeSpheres,
    isBlinded: (agent) => grenades.isBlinded(agent),
    radio: (text) => hud.radio(text),
    hud: null,
    onPlantDone: (site) => rounds.onPlantDone(site),
    onDefuseDone: (site) => rounds.onDefuseDone(site),
  };
  hearing.length = 0;
  const botShots = bots.step(dt, ctx);
  applyBotShots(botShots);

  // Round transitions: new buy phase -> set up the next round.
  if (rounds.state.round !== lastRound || rounds.state.phase !== lastPhase) {
    const wasOver = rounds.state.phase === 'over';
    if (rounds.state.phase === 'buy' && rounds.state.round !== lastRound) {
      lastRound = rounds.state.round;
      lastPhase = rounds.state.phase;
      setupRound();
    } else {
      lastRound = rounds.state.round;
      lastPhase = rounds.state.phase;
      if (rounds.state.phase === 'live') hud.hideBuyMenu();
      if (wasOver) hud.showOverlay('end', { scoreA: rounds.state.scoreA, scoreB: rounds.state.scoreB, winner: rounds.state.winner });
    }
  }
  syncHud();
}

// --- Frame loop --------------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    // Firing: auto weapons hold, semi weapons fire on the press edge.
    // Freeze time is quiet: no firing before the round goes live.
    const w = weapon.current ? weapon.current() : null;
    const auto = w ? w.auto : true;
    const fireEdge = input.state.firing && !prevFiring;
    prevFiring = input.state.firing;
    if (playerAlive && rounds.state.phase === 'live' && weapon.ready() && (auto ? input.state.firing : fireEdge)) {
      shootPlayer();
    }
    // Empty magazine: pull the reload on the trigger press instead of clicking dry.
    if (playerAlive && input.state.firing && weapon.state.mag === 0 && weapon.state.reserve > 0) {
      weapon.reload();
    }
    if (input.state.keys.has('KeyR')) weapon.reload();
    // Weapon slots 1/2/3: koi, kept primary, tanto.
    const slots = [...new Set(['koi', rounds.state.loadout.weapon, 'tanto'])];
    if (input.state.keys.has('Digit1') && slots[0]) weapon.select(slots[0]);
    if (input.state.keys.has('Digit2') && slots[1]) weapon.select(slots[1]);
    if (input.state.keys.has('Digit3') && slots[2]) weapon.select(slots[2]);
    // Grenade slots 4/5/6, G throws.
    if (input.state.keys.has('Digit4')) selectedGrenade = 'thunder';
    if (input.state.keys.has('Digit5')) selectedGrenade = 'mist';
    if (input.state.keys.has('Digit6')) selectedGrenade = 'dawn';
    const throwKey = input.state.keys.has('KeyG');
    if (throwKey && !prevThrowKey && selectedGrenade && playerAlive) {
      const inv = rounds.state.loadout.grenades[selectedGrenade];
      if (inv > 0) {
        camera.getWorldDirection(direction);
        const origin = tmpVec.copy(body.position);
        origin.y += body.eye;
        grenades.throw(selectedGrenade, origin, direction);
        rounds.state.loadout.grenades[selectedGrenade] -= 1;
      }
    }
    prevThrowKey = throwKey;
    // Buy menu on B during the buy phase.
    const buyKey = input.state.keys.has('KeyB');
    if (buyKey && !prevBuyKey && rounds.canBuy()) openBuyMenu();
    prevBuyKey = buyKey;

    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

// --- Overlay / lock ------------------------------------------------------------------------
hud.onPlay(() => {
  if (shot) return;
  if (!started) {
    started = true;
    startMatch();
  } else if (rounds.state.phase === 'over') {
    startMatch();
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (rounds.state.phase !== 'over') {
    hud.showOverlay(started ? 'paused' : 'start', { scoreA: rounds.state.scoreA, scoreB: rounds.state.scoreB });
  }
}

// --- Deterministic shot modes (?shot=start|play|end|plant&seed=N) ---------------------------
function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  started = true;
  startMatch();
  body.pitch = 0;
  body.yaw = 0;
  // Every shot but 'start' is a live-round moment: skip the buy phase so the buy
  // menu is closed, the timer reads LIVE and bots may spot and fight.
  if (name !== 'start') {
    rounds.state.phase = 'live';
    rounds.state.timer = 75;
  }
  if (name === 'start') {
    // Attack spawn vista: staged from inside the mid gate (the spawn wall and
    // the bots spawning behind it would fill the frame from the spawn point),
    // looking north down the Bamboo Walk. Buy menu open, HUD full.
    body.position.set(0, 0, 9);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -11));
    openBuyMenu();
  } else if (name === 'play') {
    // Bamboo Walk: a defender stands mid-corridor and a second one holds deeper;
    // the shot flies past the first bot (tracer visible, nobody dies for the camera).
    body.position.set(0, 0, 5);
    settle(20);
    const target = bots.list.find((b) => b.team === 'defend' && b.alive);
    if (target) {
      target.group.position.set(0.5, 0, -3);
      target.yaw = Math.PI;
      target.group.rotation.y = target.yaw;
      const second = bots.list.find((b) => b.team === 'defend' && b.alive && b !== target);
      if (second) {
        second.group.position.set(-1.8, 0, -6.5);
        second.yaw = Math.PI;
        second.group.rotation.y = second.yaw;
      }
      aimAt(new THREE.Vector3(1.4, 1.3, -3));
      shootPlayer();
      settle(1);
      aimAt(new THREE.Vector3(1.4, 1.3, -3));
    }
    hud.radio('Rin: Contact, Bamboo Walk — two spotted');
  } else if (name === 'plant') {
    // Shrine A: charge planted, fuse banner, a defender rotating in.
    body.position.set(-11, 0, -9);
    rounds.onPlantDone('A');
    const defender = bots.list.find((b) => b.team === 'defend' && b.alive);
    if (defender) {
      defender.group.position.set(-4, 0, -4);
      defender.state = 'rotate';
      defender.path = [world.waypoints.get('court'), world.waypoints.get('aSite')].filter(Boolean);
      defender.pathIndex = 0;
    }
    settle(20);
    aimAt(new THREE.Vector3(-13, 1.4, -11));
    hud.setSiteBanner('SPARK PLANTED — Site A, 40 seconds on the fuse');
  } else if (name === 'end') {
    // River crossing, round-end banner.
    body.position.set(13, 0, -4);
    settle(20);
    aimAt(new THREE.Vector3(13, 1.2, -11));
    hud.showBanner('MONSOON WINS THE ROUND', 'charge detonated — Site B');
  }
  syncHud();
  syncCamera();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else {
  hud.showOverlay('start', { scoreA: 0, scoreB: 0 });
  requestAnimationFrame(frame);
}
