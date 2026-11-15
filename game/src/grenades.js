// Grenades: thunder (frag), mist (smoke), dawn (flash).
// createGrenades(scene, world, rng) -> { throw, step, active, smokeSpheres, isBlinded }
//
// Physics: ballistic arc, one bounce off the ground (damp 0.4), then settle.
//   thunder: 1.2 s fuse from throw, then explodes: 90 dmg at <=3 m falling to 20 at 8 m.
//     Damage is blocked by walls (LOS raycast vs world.shootables) -- no damage through walls.
//   mist: on landing, a smoke cloud for 14 s, radius 4 m. Exposed as `smokeSpheres`
//     (array of {center, radius, ttl}) so bots.js can treat it as opaque in LOS checks.
//   dawn: on landing, blinds agents facing it within 25 m and 100 deg for up to 2.5 s,
//     scaled by angle and distance. The player screen whites out via ctx.hud.flashBlind.
//     Agent blindness is tracked per agent; bots query it with isBlinded(agent).
//
// step(dt, ctx) returns an array of effect events for main.js:
//   { type: 'explode', kind: 'thunder', pos: Vector3, victims: [{ agent, damage }] }
//   { type: 'smoke', pos: Vector3 }            (mist landed)
//   { type: 'flash', pos: Vector3 }            (dawn landed)
//   { type: 'blind', agent, strength, until }  (an agent was blinded; agent is 'player' or a bot)
// ctx shape: { time, playerPos, playerAlive, playerYaw, bots: bot[], hud }.
//   `bots` is bots.list (may be empty / omitted). `hud` may be null outside play.
// Damage events are only *reported* here; main.js applies them (bots.damage / player.damage).
import * as THREE from 'three';

const GRAVITY = 12;
const THROW_SPEED = 14;
const THROW_UP = 4.5;
const FUSE_THUNDER = 1.2;
const SMOKE_TTL = 14;
const SMOKE_RADIUS = 4;
const BLAST_MAX = 90;
const BLAST_MIN = 20;
const BLAST_INNER = 3;
const BLAST_OUTER = 8;
const FLASH_RANGE = 25;
const FLASH_FOV_DEG = 100;
const FLASH_MAX = 2.5;

const KIND_COLORS = { thunder: 0x2a2e2a, mist: 0x5a6b52, dawn: 0xe8d27a };

export function createGrenades(scene, world, rng) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  const live = []; // active grenades in flight / burning
  const smokeSpheres = []; // { center: Vector3, radius, ttl }
  const blindUntil = new Map(); // agent (object or 'player') -> time when blindness ends
  let now = 0; // sim time, refreshed each step; isBlinded reads it

  const sphereGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);

  function makeMesh(kind) {
    const mat = new THREE.MeshStandardMaterial({ color: KIND_COLORS[kind] || 0x333333, roughness: 0.6, metalness: 0.3 });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    const light = new THREE.PointLight(0xff5040, 0, 3);
    light.position.set(0, 0.05, 0);
    mesh.add(light);
    scene.add(mesh);
    return { mesh, light };
  }

  function makeSmokeMesh(center) {
    const group = new THREE.Group();
    const mats = [];
    for (let i = 0; i < 3; i += 1) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xdfe8dd, transparent: true, opacity: 0.32 - i * 0.07, depthWrite: false,
      });
      const sphere = new THREE.Mesh(smokeGeo, mat);
      const scale = SMOKE_RADIUS * (0.55 + i * 0.22);
      sphere.scale.set(scale, scale * 0.55, scale);
      sphere.position.set((rng() * 2 - 1) * 1.2, 0.4 + i * 0.5, (rng() * 2 - 1) * 1.2);
      group.add(sphere);
      mats.push(mat);
    }
    group.position.copy(center);
    scene.add(group);
    return { group, mats };
  }

  function isBlinded(agent) {
    const until = blindUntil.get(agent);
    return until !== undefined && until > now;
  }

  function throwGrenade(kind, origin, dir) {
    if (kind !== 'thunder' && kind !== 'mist' && kind !== 'dawn') return null;
    const { mesh, light } = makeMesh(kind);
    mesh.position.copy(origin);
    const vel = tmpA.copy(dir).normalize().multiplyScalar(THROW_SPEED);
    vel.y += THROW_UP;
    const g = {
      kind,
      mesh,
      light,
      vel: vel.clone(),
      fuse: kind === 'thunder' ? FUSE_THUNDER : Infinity,
      bounced: false,
      settled: false,
      blink: 0,
      smokeMesh: null,
    };
    live.push(g);
    return g;
  }

  function blastDamage(pos, ctx, events) {
    const victims = [];
    const check = (agent, agentPos, eyeY) => {
      tmpA.copy(agentPos);
      tmpA.y += eyeY;
      const dist = tmpB.copy(tmpA).sub(pos).length();
      if (dist > BLAST_OUTER) return;
      // No damage through walls: LOS from the blast to the agent must be clear.
      tmpC.copy(tmpA).sub(pos).normalize();
      raycaster.set(pos, tmpC);
      raycaster.far = dist;
      const blocked = raycaster.intersectObjects(world.shootables, false).length > 0;
      if (blocked) return;
      const t = Math.max(0, Math.min(1, (dist - BLAST_INNER) / (BLAST_OUTER - BLAST_INNER)));
      const damage = Math.round(BLAST_MAX + (BLAST_MIN - BLAST_MAX) * t);
      victims.push({ agent, damage });
    };
    if (ctx.playerAlive && ctx.playerPos) check('player', ctx.playerPos, 1.2);
    if (ctx.bots) {
      for (const bot of ctx.bots) {
        if (bot.alive) check(bot, bot.group.position, 1.1);
      }
    }
    events.push({ type: 'explode', kind: 'thunder', pos: pos.clone(), victims });
  }

  function flashAgents(pos, ctx, events) {
    const blindOne = (agent, agentPos, forward) => {
      tmpA.copy(agentPos);
      tmpA.y += 1.4;
      tmpB.copy(tmpA).sub(pos);
      const dist = tmpB.length();
      if (dist > FLASH_RANGE) return;
      tmpB.normalize();
      // Facing the flash: the agent's forward must point toward the flash point.
      const facing = forward ? tmpC.copy(forward).dot(tmpB) : -1;
      const angle = Math.acos(Math.max(-1, Math.min(1, facing))) * (180 / Math.PI);
      if (angle > FLASH_FOV_DEG / 2) return;
      // Walls block the flash.
      raycaster.set(pos, tmpB);
      raycaster.far = dist;
      if (raycaster.intersectObjects(world.shootables, false).length > 0) return;
      const angleScale = 1 - angle / FLASH_FOV_DEG;
      const distScale = 1 - dist / FLASH_RANGE;
      const strength = Math.max(0.15, Math.min(1, angleScale * 0.7 + distScale * 0.6));
      const duration = FLASH_MAX * strength;
      const until = ctx.time + duration;
      blindUntil.set(agent, until);
      events.push({ type: 'blind', agent, strength, until });
    };
    if (ctx.playerAlive && ctx.playerPos) {
      // Player forward from yaw: forward = (-sin yaw, 0, -cos yaw).
      tmpDir.set(-Math.sin(ctx.playerYaw || 0), 0, -Math.cos(ctx.playerYaw || 0));
      blindOne('player', ctx.playerPos, tmpDir);
      if (ctx.hud && typeof ctx.hud.flashBlind === 'function') {
        const until = blindUntil.get('player');
        if (until !== undefined) ctx.hud.flashBlind(Math.min(1, (until - ctx.time) / FLASH_MAX));
      }
    }
    if (ctx.bots) {
      for (const bot of ctx.bots) {
        if (!bot.alive) continue;
        tmpDir.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
        blindOne(bot, bot.group.position, tmpDir);
      }
    }
  }

  function step(dt, ctx) {
    const events = [];
    now = ctx.time;
    // Expire old blindness entries.
    for (const [agent, until] of blindUntil) {
      if (until <= ctx.time) blindUntil.delete(agent);
    }
    // Smoke clouds age out.
    for (let i = smokeSpheres.length - 1; i >= 0; i -= 1) {
      const s = smokeSpheres[i];
      s.ttl -= dt;
      if (s.ttl <= 0) {
        scene.remove(s.mesh.group);
        for (const mat of s.mesh.mats) mat.dispose();
        smokeSpheres.splice(i, 1);
      }
    }
    // Grenades in flight.
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const g = live[i];
      g.blink += dt;
      g.light.intensity = g.kind === 'thunder' && !g.settled
        ? (Math.sin(g.blink * 18) > 0 ? 6 : 0.5)
        : 0;
      if (!g.settled) {
        g.vel.y -= GRAVITY * dt;
        g.mesh.position.addScaledVector(g.vel, dt);
        const p = g.mesh.position;
        // Ground bounce, once.
        if (p.y <= 0.09) {
          p.y = 0.09;
          if (!g.bounced) {
            g.vel.y = Math.abs(g.vel.y) * 0.4;
            g.vel.x *= 0.6;
            g.vel.z *= 0.6;
            g.bounced = true;
          } else {
            g.vel.set(0, 0, 0);
            g.settled = true;
          }
        }
        // Wall bounce, once: if inside a solid collider, push out along the
        // smallest penetration axis and damp the velocity component.
        if (!g.settled) {
          for (const box of world.colliders) {
            if (!box.containsPoint(p)) continue;
            const dxMin = p.x - box.min.x;
            const dxMax = box.max.x - p.x;
            const dzMin = p.z - box.min.z;
            const dzMax = box.max.z - p.z;
            const m = Math.min(dxMin, dxMax, dzMin, dzMax);
            if (!g.bounced) {
              if (m === dxMin) { p.x = box.min.x - 0.09; g.vel.x = -Math.abs(g.vel.x) * 0.4; }
              else if (m === dxMax) { p.x = box.max.x + 0.09; g.vel.x = Math.abs(g.vel.x) * 0.4; }
              else if (m === dzMin) { p.z = box.min.z - 0.09; g.vel.z = -Math.abs(g.vel.z) * 0.4; }
              else { p.z = box.max.z + 0.09; g.vel.z = Math.abs(g.vel.z) * 0.4; }
              g.bounced = true;
            } else {
              g.vel.set(0, 0, 0);
              g.settled = true;
            }
            break;
          }
        }
      }
      if (g.kind === 'thunder') {
        g.fuse -= dt;
        if (g.fuse <= 0) {
          blastDamage(g.mesh.position, ctx, events);
          scene.remove(g.mesh);
          live.splice(i, 1);
          continue;
        }
      } else if (g.settled) {
        // Mist and dawn trigger on landing.
        if (g.kind === 'mist') {
          const center = g.mesh.position.clone();
          center.y = 0.6;
          const mesh = makeSmokeMesh(center);
          smokeSpheres.push({ center, radius: SMOKE_RADIUS, ttl: SMOKE_TTL, mesh });
          events.push({ type: 'smoke', pos: center.clone() });
        } else if (g.kind === 'dawn') {
          const pos = g.mesh.position.clone();
          flashAgents(pos, ctx, events);
          events.push({ type: 'flash', pos });
        }
        scene.remove(g.mesh);
        live.splice(i, 1);
      }
    }
    return events;
  }

  return {
    throw: throwGrenade,
    step,
    active: live,
    smokeSpheres,
    isBlinded,
  };
}
