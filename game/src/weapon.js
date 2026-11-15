// Weapons for JADE PASS: the table owns the numbers, the viewmodel owns the look.
// Main.js owns the ray and the damage; this module owns the magazine, the fire-rate
// gate, the spread cone, the reload timer, and the low-poly gun in the camera.
// No unseeded randomness anywhere in the sim: spread jitter comes from the seeded rng
// passed in as createWeapon(camera, rng) — the same mulberry32 main.js shares with
// every other module. If no rng is passed, a fixed-seed deterministic fallback is
// used, so behaviour never depends on the global random source.
// flashMuzzle() internally (40 ms additive plane at the barrel); flashMuzzle() is
// also exposed so main.js can flash without spending a round if it ever needs to.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  typhoon: {
    name: 'TYPHOON AR', kind: 'rifle', auto: true, rate: 0.115, damage: 27, headMul: 4,
    mag: 25, reserve: 75, reload: 2.4, spreadBase: 0.004, spreadMove: 0.028, spreadAir: 0.05,
    recoil: 0.011, price: 2700, range: 90,
  },
  cicada: {
    name: 'CICADA-9 SMG', kind: 'smg', auto: true, rate: 0.085, damage: 19, headMul: 4,
    mag: 28, reserve: 84, reload: 2.0, spreadBase: 0.008, spreadMove: 0.03, spreadAir: 0.05,
    recoil: 0.008, price: 1500, range: 60,
  },
  koi: {
    name: 'KOI-9', kind: 'pistol', auto: false, rate: 0.18, damage: 34, headMul: 4, mag: 12,
    reserve: 48, reload: 1.6, spreadBase: 0.003, spreadMove: 0.02, spreadAir: 0.04, recoil: 0.01,
    price: 300, range: 50,
  },
  crane: {
    name: 'CRANE DMR', kind: 'dmr', auto: false, rate: 0.9, damage: 78, headMul: 4, mag: 8,
    reserve: 24, reload: 2.8, spreadBase: 0.001, spreadMove: 0.05, spreadAir: 0.08, recoil: 0.03,
    price: 3300, range: 120,
  },
  tanto: {
    name: 'TANTO', kind: 'knife', auto: false, rate: 0.5, damage: 40, headMul: 1, mag: -1,
    reserve: -1, reload: 0, spreadBase: 0, spreadMove: 0, spreadAir: 0, recoil: 0, price: 0, range: 2.2,
  },
};

const MUZZLE_TIME = 0.04; // 40 ms flash per shot
const MOVE_REFERENCE = 5.2; // walk speed: spreadMove applies in full at this speed
const MODEL_POS = new THREE.Vector3(0.24, -0.2, -0.42);

// Per-weapon viewmodel recipe: silhouette + accent colour. All boxes, no textures.
const MODELS = {
  typhoon: { accent: PALETTE.accent, barrel: 0.42, mag: true, stock: true, scope: false, blade: false },
  cicada: { accent: PALETTE.teamAttack, barrel: 0.24, mag: true, stock: false, scope: false, blade: false },
  koi: { accent: PALETTE.vermilion, barrel: 0.14, mag: false, stock: false, scope: false, blade: false },
  crane: { accent: PALETTE.bamboo, barrel: 0.62, mag: true, stock: true, scope: true, blade: false },
  tanto: { accent: PALETTE.accent, barrel: 0, mag: false, stock: false, scope: false, blade: true },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWeapon(camera, rng) {
  const random = typeof rng === 'function' ? rng : mulberry32(1);
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.slate), roughness: 0.5, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });

  const state = {
    id: 'koi', mag: WEAPONS.koi.mag, reserve: WEAPONS.koi.reserve,
    reloading: false, cooldown: 0,
  };
  let model = null;
  let reloadLeft = 0;
  let flashLeft = 0;
  let flashSpin = 0;
  let kick = 0;
  let muzzlePos = new THREE.Vector3(0.24, -0.18, -0.95);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.07),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.6,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }),
  );
  flash.visible = false;
  camera.add(flash);

  function buildModel(id) {
    const recipe = MODELS[id];
    const group = new THREE.Group();
    const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(recipe.accent), roughness: 0.45, metalness: 0.3 });
    if (recipe.blade) {
      // TANTO: a short dark blade held low, gold edge strip, no barrel, no flash.
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.34), steel);
      blade.position.set(0, -0.02, -0.18);
      blade.rotation.x = -0.35;
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.012, 0.34), accent);
      edge.position.set(0, -0.045, -0.18);
      edge.rotation.x = -0.35;
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.07), dark);
      grip.position.set(0, -0.05, 0.02);
      group.add(blade, edge, grip);
      muzzlePos.set(0.24, -0.18, -0.42);
    } else {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), steel);
      group.add(receiver);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, recipe.barrel), dark);
      barrel.position.set(0, 0.025, -0.17 - recipe.barrel / 2);
      group.add(barrel);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.02, 0.3), accent);
      stripe.position.set(0, 0.055, 0);
      group.add(stripe);
      if (recipe.mag) {
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), dark);
        mag.position.set(0, -0.12, -0.02);
        mag.rotation.x = 0.15;
        group.add(mag);
      }
      if (recipe.stock) {
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), dark);
        stock.position.set(0, -0.02, 0.28);
        group.add(stock);
      }
      if (recipe.scope) {
        const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.18), dark);
        scope.position.set(0, 0.09, -0.02);
        group.add(scope);
      }
      if (id === 'koi') {
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.07), dark);
        grip.position.set(0, -0.1, 0.1);
        grip.rotation.x = 0.25;
        group.add(grip);
      }
      muzzlePos.set(0.24, -0.175, -0.42 - 0.17 - recipe.barrel);
    }
    group.position.copy(MODEL_POS);
    return group;
  }

  function attachModel(id) {
    if (model) camera.remove(model);
    model = buildModel(id);
    camera.add(model);
    flash.position.copy(muzzlePos);
  }
  attachModel(state.id);

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    flashLeft = Math.max(0, flashLeft - dt);
    kick += (0 - kick) * Math.min(1, dt * 14);
    if (model) {
      model.position.z = MODEL_POS.z + kick;
      model.rotation.x = kick * 2.2;
    }
    flash.visible = flashLeft > 0;
    if (flash.visible) flash.rotation.z = flashSpin;
    if (reloadLeft > 0) {
      const def = WEAPONS[state.id];
      reloadLeft = Math.max(0, reloadLeft - dt);
      // Reload dip: the gun drops and tilts, deepest halfway through.
      const progress = def.reload > 0 ? 1 - reloadLeft / def.reload : 1;
      const dip = Math.sin(progress * Math.PI);
      if (model) {
        model.rotation.x = -0.55 * dip;
        model.position.y = MODEL_POS.y - 0.08 * dip;
      }
      if (reloadLeft === 0) {
        state.reloading = false;
        if (model) {
          model.rotation.x = 0;
          model.position.y = MODEL_POS.y;
        }
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    select(id) {
      if (!WEAPONS[id] || id === state.id) return false;
      const def = WEAPONS[id];
      state.id = id;
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.reloading = false;
      state.cooldown = 0;
      reloadLeft = 0;
      flashLeft = 0;
      kick = 0;
      attachModel(id);
      return true;
    },
    // Spend one round. Returns false if the gun cannot fire right now.
    // Sets the fire-rate cooldown, the recoil kick and the 40 ms muzzle flash.
    takeRound() {
      const def = WEAPONS[state.id];
      if (!this.ready()) return false;
      if (state.mag > 0) state.mag -= 1;
      state.cooldown = def.rate;
      kick = 0.055;
      if (state.id !== 'tanto') this.flashMuzzle();
      return true;
    },
    reload() {
      const def = WEAPONS[state.id];
      if (def.mag < 0 || state.reloading || state.mag >= def.mag || state.reserve <= 0) return false;
      state.reloading = true;
      reloadLeft = def.reload;
      return true;
    },
    ready() {
      if (state.cooldown > 0 || state.reloading) return false;
      return state.mag !== 0; // tanto has mag -1: always ready when off cooldown
    },
    // Spread cone half-angle (radians). Moving widens it, air widens it more,
    // crouching tightens the still + moving part by 40%.
    spread(moveSpeed, airborne, crouching) {
      const def = WEAPONS[state.id];
      const movePart = Math.min(1, moveSpeed / MOVE_REFERENCE) * def.spreadMove;
      const airPart = airborne ? def.spreadAir : 0;
      const base = crouching ? (def.spreadBase + movePart) * 0.6 : def.spreadBase + movePart;
      return base + airPart;
    },
    flashMuzzle() {
      flashLeft = MUZZLE_TIME;
      flashSpin = random() * Math.PI * 2; // seeded rng only
    },
    current() {
      return WEAPONS[state.id];
    },
  };
}
