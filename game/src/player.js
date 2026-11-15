// Player movement and health for JADE PASS: acceleration, friction, gravity,
// crouch and jump, resolved as a box against the world's colliders one axis at a
// time, so a wall never swallows the player and sliding along it still works.
// Armour sits in front of health: while armour remains, it absorbs half of every
// hit and health takes the other half. state.dead flips the moment hp hits zero.
import * as THREE from 'three';

export const PLAYER_RADIUS = 0.34;
export const PLAYER_STAND_HEIGHT = 1.72;
export const PLAYER_CROUCH_HEIGHT = 1.12;
export const PLAYER_STAND_EYE = 1.6;
export const PLAYER_CROUCH_EYE = 1.02;
export const PLAYER_WALK_SPEED = 5.2;
export const PLAYER_CROUCH_SPEED = 2.4;
export const PLAYER_ACCEL = 42;
export const PLAYER_AIR_ACCEL = 9;
export const PLAYER_FRICTION = 9;
export const PLAYER_GRAVITY = 20;
export const PLAYER_JUMP_SPEED = 6.2;
export const PLAYER_MAX_HP = 100;
const ARMOUR_ABSORB = 0.5; // fraction of a hit the armour takes while it lasts
const PITCH_LIMIT = 1.45;

export function createPlayer(colliders) {
  const state = {
    position: new THREE.Vector3(0, 0, 15), // attack spawn, south yard
    velocity: new THREE.Vector3(),
    yaw: 0, // 0 faces north (-z), toward the shrine
    pitch: 0,
    eye: PLAYER_STAND_EYE,
    onGround: true,
    crouching: false,
    height: PLAYER_STAND_HEIGHT,
    hp: PLAYER_MAX_HP,
    armour: 0,
    dead: false,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing
  // on the ground (or on a terrace step) is not read as walking into a wall.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - PLAYER_RADIUS, y + lift, z - PLAYER_RADIUS);
    probe.max.set(x + PLAYER_RADIUS, y + height - lift, z + PLAYER_RADIUS);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(PITCH_LIMIT, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys) {
    if (state.dead) return;
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !state.crouching) {
      state.crouching = true;
      state.height = PLAYER_CROUCH_HEIGHT;
    } else if (!wantCrouch && state.crouching
      && !overlaps(state.position.x, state.position.y, state.position.z, PLAYER_STAND_HEIGHT, 0.02)) {
      // Only stand up when there is headroom (e.g. leaving the underpass arch).
      state.crouching = false;
      state.height = PLAYER_STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? PLAYER_CROUCH_EYE : PLAYER_STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = state.crouching ? PLAYER_CROUCH_SPEED : PLAYER_WALK_SPEED;
    const blend = Math.min(1, (state.onGround ? PLAYER_ACCEL : PLAYER_AIR_ACCEL) * dt / speed);
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - PLAYER_FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }

    if (keys.has('Space') && state.onGround) {
      state.velocity.y = PLAYER_JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= PLAYER_GRAVITY * dt;

    // Axis-separated: each axis moves only if the box fits there. A blocked axis
    // zeroes that velocity component instead of stopping the player outright.
    const nextX = state.position.x + state.velocity.x * dt;
    if (!overlaps(nextX, state.position.y, state.position.z, state.height, 0.04)) {
      state.position.x = nextX;
    } else {
      state.velocity.x = 0;
    }
    const nextZ = state.position.z + state.velocity.z * dt;
    if (!overlaps(state.position.x, state.position.y, nextZ, state.height, 0.04)) {
      state.position.z = nextZ;
    } else {
      state.velocity.z = 0;
    }

    state.position.y += state.velocity.y * dt;
    state.onGround = false;
    const hit = overlaps(state.position.x, state.position.y, state.position.z, state.height, 0);
    if (hit && state.velocity.y <= 0) {
      state.position.y = hit.max.y;
      state.velocity.y = 0;
      state.onGround = true;
    } else if (hit) {
      state.position.y = hit.min.y - state.height;
      state.velocity.y = 0;
    }
    if (state.position.y < 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
    }
    state.velocity.y = Math.max(-30, state.velocity.y);
  }

  // Armour absorbs half the hit while it lasts; health takes the rest.
  function damage(amount) {
    if (state.dead || amount <= 0) return;
    const absorbed = Math.min(state.armour, amount * ARMOUR_ABSORB);
    state.armour -= absorbed;
    state.hp -= (amount - absorbed);
    if (state.hp <= 0) {
      state.hp = 0;
      state.dead = true;
    }
  }

  return {
    state,
    step,
    look,
    recoil,
    damage,
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
    // Extra helpers for rounds.js / main.js: buy armour, and respawn at a point.
    setArmour(n) {
      state.armour = Math.max(0, Math.min(100, n));
    },
    reset(x, z, yaw = 0) {
      state.position.set(x, 0, z);
      state.velocity.set(0, 0, 0);
      state.yaw = yaw;
      state.pitch = 0;
      state.hp = PLAYER_MAX_HP;
      state.armour = 0;
      state.dead = false;
      state.crouching = false;
      state.height = PLAYER_STAND_HEIGHT;
      state.eye = PLAYER_STAND_EYE;
      state.onGround = true;
    },
  };
}
