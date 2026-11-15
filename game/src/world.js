// JADE PASS — mountain shrine pass in a bamboo forest, golden morning mist.
// Coordinates: x east, z south, y up. Ground y = 0. Bounds x [-22, 22], z [-18, 18].
// Attackers spawn south (z ~ +15), defenders north (z ~ -15).
//
// Sites: A Shrine Steps (north-west, terrace + vermilion torii), B River Crossing
// (north-east, wooden bridge over a stream). Mid is the Bamboo Walk; Lantern Court
// sits mid-north and the Underpass is a crouch-height stone arch at (0, 0, -6).
// Bamboo clusters are visual cover you can walk through, except 3 thick bamboo-wall
// blocks which are solid. No text textures anywhere: site letters are built from boxes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Fallback seed used only when main.js does not pass its shared rng in.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld(scene, rng) {
  const rand = rng || mulberry32(1337);
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  // Water: translucent blue-green. Mist: pale, barely there. Glow: lantern chambers.
  const waterMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.water), roughness: 0.35, metalness: 0.05,
    transparent: true, opacity: 0.85,
  });
  const mistMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.fog), transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false, fog: false,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0,
    emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.85,
  });
  const mountainMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.bambooDark), roughness: 1, metalness: 0,
  });

  const colliders = [];
  const shootables = [];
  // Animated bits (mist drift, floating site letters). update() moves them by numbers
  // only — no allocations per frame.
  const animators = [];

  function register(mesh, solid) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Solid: a collider the player bumps into and a bullet stops on.
  function box(w, h, d, x, y, z, mat, rotY) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[mat]);
    mesh.position.set(x, y, z);
    if (rotY) mesh.rotation.y = rotY;
    return register(mesh, true);
  }
  // Visual: shootable cover/decor, but the player walks straight through it.
  function visualBox(w, h, d, x, y, z, mat, rotY) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[mat]);
    mesh.position.set(x, y, z);
    if (rotY) mesh.rotation.y = rotY;
    return register(mesh, false);
  }
  // Deco: neither collider nor bullet target (mist, mountains, ground decals, rings).
  function decoBox(w, h, d, x, y, z, mat, rotY) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    if (rotY) mesh.rotation.y = rotY;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  function cylinder(rTop, rBottom, h, x, y, z, mat, solid, rotY) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 10), materials[mat]);
    mesh.position.set(x, y, z);
    if (rotY) mesh.rotation.y = rotY;
    return register(mesh, solid);
  }

  // ---- ground + sky -------------------------------------------------------
  const ground = new THREE.Mesh(new THREE.BoxGeometry(44.6, 0.4, 36.6), materials.moss);
  ground.position.set(0, -0.2, 0);
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 25, 70);

  // ---- perimeter: stone walls with vermilion trim --------------------------
  box(44.6, 3.2, 0.6, 0, 1.6, -18, 'stone');
  box(44.6, 3.2, 0.6, 0, 1.6, 18, 'stone');
  box(0.6, 3.2, 36.6, -22, 1.6, 0, 'stone');
  box(0.6, 3.2, 36.6, 22, 1.6, 0, 'stone');
  visualBox(44.6, 0.18, 0.7, 0, 3.28, -18, 'vermilion');
  visualBox(44.6, 0.18, 0.7, 0, 3.28, 18, 'vermilion');
  visualBox(0.7, 0.18, 36.6, -22, 3.28, 0, 'vermilion');
  visualBox(0.7, 0.18, 36.6, 22, 3.28, 0, 'vermilion');

  // ---- stone paths (flat decals along the lanes) ---------------------------
  decoBox(2.2, 0.02, 30, -19, 0.01, 0, materials.stone);
  decoBox(2.2, 0.02, 30, 19, 0.01, 0, materials.stone);
  decoBox(2.4, 0.02, 34, 0, 0.01, 0, materials.stone);
  decoBox(24, 0.02, 2.2, 0, 0.01, -8.5, materials.stone);

  // ---- props ---------------------------------------------------------------
  function crate(x, z, s, rotY) {
    box(s, s, s, x, s / 2, z, 'wood', rotY);
    visualBox(s * 1.02, 0.08, s * 1.02, x, s - 0.04, z, 'woodDark', rotY);
  }
  function barrel(x, z) {
    cylinder(0.42, 0.42, 1.0, x, 0.5, z, 'woodDark', true);
    cylinder(0.45, 0.45, 0.08, x, 0.82, z, 'wood', true);
  }
  function lantern(x, z, y) {
    const base = y || 0;
    box(0.5, 0.18, 0.5, x, base + 0.09, z, 'stoneDark');
    box(0.22, 0.7, 0.22, x, base + 0.53, z, 'stoneDark');
    const chamber = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.42), glowMat);
    chamber.position.set(x, base + 1.05, z);
    register(chamber, false);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 4), materials.stoneDark);
    cap.position.set(x, base + 1.37, z);
    cap.rotation.y = Math.PI / 4;
    register(cap, false);
  }
  function torii(x, z, rotY) {
    // Two vermilion pillars, a long top lintel with a smaller tie lintel below.
    const c = Math.cos(rotY || 0);
    const s = Math.sin(rotY || 0);
    const px = 1.55;
    const p1x = x - px * c;
    const p1z = z + px * s;
    const p2x = x + px * c;
    const p2z = z - px * s;
    cylinder(0.16, 0.19, 3.4, p1x, 1.7, p1z, 'vermilion', true);
    cylinder(0.16, 0.19, 3.4, p2x, 1.7, p2z, 'vermilion', true);
    box(3.9, 0.26, 0.34, x, 3.55, z, 'vermilionDark', rotY);
    box(3.3, 0.2, 0.26, x, 3.05, z, 'vermilion', rotY);
    box(0.34, 0.5, 0.1, x, 3.28, z, 'slate', rotY);
  }
  function hut(x, z, w, d, rotY, wallMat) {
    box(w, 2.2, d, x, 1.1, z, wallMat || 'wood', rotY);
    box(w * 0.7, 1.5, 0.08, x, 0.75, z + d / 2 + 0.01, 'slate', rotY);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.1, 4), materials.slate);
    roof.position.set(x, 2.75, z);
    roof.rotation.y = Math.PI / 4 + (rotY || 0);
    register(roof, false);
    visualBox(w * 0.9, 0.12, d * 0.9, x, 2.26, z, 'slate', rotY);
  }
  // One shared stalk geometry, scaled per stalk: cheap and varied.
  const stalkGeo = new THREE.CylinderGeometry(0.07, 0.09, 1, 6);
  function bambooCluster(cx, cz, count, spread) {
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * spread;
      const h = 4 + rand() * 2;
      const stalk = new THREE.Mesh(stalkGeo, rand() < 0.5 ? materials.bamboo : materials.bambooDark);
      stalk.position.set(cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r);
      stalk.scale.set(0.8 + rand() * 0.5, h, 0.8 + rand() * 0.5);
      stalk.rotation.z = (rand() - 0.5) * 0.14;
      stalk.rotation.x = (rand() - 0.5) * 0.14;
      register(stalk, false);
    }
  }
  // A dense thicket block: solid cover, unlike the walk-through clusters.
  function bambooWall(cx, cz, w, d, rotY) {
    box(w, 2.6, d, cx, 1.3, cz, 'bambooDark', rotY);
    const n = Math.floor(w * 3);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const h = 3 + rand() * 1.6;
      const stalk = new THREE.Mesh(stalkGeo, i % 2 ? materials.bamboo : materials.bambooDark);
      const lx = Math.cos(rotY || 0) * t * w;
      const lz = -Math.sin(rotY || 0) * t * w;
      stalk.position.set(cx + lx, h / 2 + 2.4, cz + lz + (rand() - 0.5) * d * 0.6);
      stalk.scale.set(1, h, 1);
      stalk.rotation.z = (rand() - 0.5) * 0.1;
      register(stalk, false);
    }
  }
  function ring(x, y, z, radius) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.07, 8, 40), materials.vermilion);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  // Site letters built from plain boxes — no canvas, no text textures.
  function letterA() {
    const g = new THREE.Group();
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.08), materials.vermilion);
    legL.position.set(-0.28, 0, 0);
    legL.rotation.z = 0.32;
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.08), materials.vermilion);
    legR.position.set(0.28, 0, 0);
    legR.rotation.z = -0.32;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.08), materials.vermilion);
    bar.position.set(0, -0.12, 0);
    g.add(legL, legR, bar);
    return g;
  }
  function letterB() {
    const g = new THREE.Group();
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.08), materials.vermilion);
    spine.position.set(-0.3, 0, 0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.08), materials.vermilion);
    top.position.set(-0.02, 0.48, 0);
    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.08), materials.vermilion);
    mid.position.set(-0.02, 0, 0);
    const bot = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.08), materials.vermilion);
    bot.position.set(-0.02, -0.48, 0);
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.08), materials.vermilion);
    up.position.set(0.22, 0.24, 0);
    const low = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.08), materials.vermilion);
    low.position.set(0.22, -0.24, 0);
    g.add(spine, top, mid, bot, up, low);
    return g;
  }
  function siteMarker(letter, x, y, z) {
    const g = letter === 'A' ? letterA() : letterB();
    g.position.set(x, y, z);
    group.add(g);
    animators.push({ obj: g, baseX: x, baseY: y, phase: rand() * Math.PI * 2, kind: 'bob' });
    return g;
  }

  // ---- SITE A: Shrine Steps (north-west) -----------------------------------
  // Raised terrace: two 0.25 m steps. Jump to climb, as in the kit's platform.
  box(9, 0.25, 7, -13, 0.125, -11, 'stone');
  box(6, 0.5, 4.5, -13, 0.25, -11, 'stoneDark');
  torii(-13, -12.6, 0);
  hut(-13, -16, 4, 3, 0, 'vermilion');
  lantern(-16.2, -8.2, 0.25);
  lantern(-9.8, -8.2, 0.25);
  lantern(-16.2, -13.8, 0.25);
  lantern(-9.8, -13.8, 0.25);
  ring(-13, 0.53, -11, 2.2);
  siteMarker('A', -13, 3.6, -11);
  bambooCluster(-17.5, -14.5, 7, 1.6);
  bambooCluster(-8.5, -14.5, 7, 1.6);

  // ---- SITE B: River Crossing (north-east) ----------------------------------
  // Stream runs east-west: water x 6..20, z -13.5..-11. Bridge crosses it at x 12..14.
  const bed = new THREE.Mesh(new THREE.BoxGeometry(14, 0.04, 2.5), materials.stoneDark);
  bed.position.set(13, 0, -12.25);
  bed.receiveShadow = true;
  group.add(bed);
  const water = new THREE.Mesh(new THREE.BoxGeometry(14, 0.05, 2.5), waterMat);
  water.position.set(13, 0.02, -12.25);
  water.receiveShadow = true;
  group.add(water);
  shootables.push(water);
  decoBox(14, 0.05, 0.5, 13, 0.03, -13.75, materials.stone);
  decoBox(14, 0.05, 0.5, 13, 0.03, -10.75, materials.stone);
  // Bridge deck (jump up 0.3 m) with plank grooves and side rails.
  box(2.0, 0.3, 5.5, 13, 0.15, -12.25, 'wood');
  for (let i = 0; i < 6; i++) {
    decoBox(2.0, 0.02, 0.08, 13, 0.31, -14.4 + i * 0.9, materials.woodDark);
  }
  box(0.14, 0.9, 5.5, 12.05, 0.75, -12.25, 'woodDark');
  box(0.14, 0.9, 5.5, 13.95, 0.75, -12.25, 'woodDark');
  hut(18.5, -15.2, 3, 3, 0, 'wood');
  hut(5.5, -16.3, 3, 3, 0, 'wood');
  lantern(10.6, -9.6, 0);
  lantern(15.4, -9.6, 0);
  lantern(10.6, -15, 0);
  lantern(15.4, -15, 0);
  ring(13, 0.03, -8.5, 2.2);
  siteMarker('B', 13, 3.6, -8.5);
  bambooCluster(18.5, -8, 6, 1.4);
  bambooCluster(8, -8.5, 6, 1.4);

  // ---- MID: Bamboo Walk + Lantern Court --------------------------------------
  bambooCluster(-3, 2, 8, 1.8);
  bambooCluster(3, -2, 8, 1.8);
  bambooCluster(-4, 7, 7, 1.6);
  bambooCluster(4, 6, 7, 1.6);
  bambooCluster(-2, -3.5, 7, 1.5);
  bambooCluster(2.5, 1.5, 7, 1.5);
  bambooCluster(-6, 4, 7, 1.6);
  bambooCluster(6, -4, 7, 1.6);
  bambooCluster(-8, 1, 6, 1.4);
  bambooCluster(8, 2, 6, 1.4);
  bambooCluster(-4, -9, 6, 1.4);
  bambooCluster(4, -9, 6, 1.4);
  bambooCluster(-6, 10, 6, 1.4);
  bambooCluster(6, 10, 6, 1.4);
  bambooCluster(-20, 6, 6, 1.4);
  bambooCluster(-20, -6, 6, 1.4);
  bambooCluster(20, 6, 6, 1.4);
  bambooCluster(20, -6, 6, 1.4);
  // Three thick bamboo-wall blocks: the only bamboo that stops the player.
  bambooWall(-6, -2, 3, 0.8, 0);
  bambooWall(6, 3, 3, 0.8, Math.PI / 2);
  bambooWall(-3, 9, 3, 0.8, 0);
  // Lantern courtyard at (0, 0, 0): low stone table, lanterns around it.
  box(2.2, 0.5, 1.2, 1.8, 0.25, -0.5, 'stone');
  lantern(-2.2, -2, 0);
  lantern(2.4, 2, 0);
  lantern(-2.4, 2.2, 0);
  // Lantern Court, mid-north, just past the underpass.
  lantern(-2.5, -8.5, 0);
  lantern(2.5, -8.5, 0);
  box(2.4, 1.1, 0.6, -4, 0.55, -8.5, 'stone');
  box(2.4, 1.1, 0.6, 4, 0.55, -8.5, 'stone');
  visualBox(2.4, 0.14, 0.66, -4, 1.16, -8.5, 'vermilion');
  visualBox(2.4, 0.14, 0.66, 4, 1.16, -8.5, 'vermilion');

  // ---- Underpass: stone wall across mid with a crouch-height arch -----------
  // Wall segments leave a 2.4 m gap at x -1.2..1.2; the lintel bottom is at 1.3 m,
  // so a standing player (1.72 m) is blocked and a crouching one (1.12 m) passes.
  box(5.6, 2.6, 0.8, -5.2, 1.3, -6, 'stone');
  box(5.6, 2.6, 0.8, 5.2, 1.3, -6, 'stone');
  box(0.8, 2.2, 0.8, -1.6, 1.1, -6, 'stoneDark');
  box(0.8, 2.2, 0.8, 1.6, 1.1, -6, 'stoneDark');
  box(4.0, 0.9, 0.8, 0, 1.75, -6, 'stone');
  visualBox(4.0, 0.14, 0.86, 0, 2.26, -6, 'vermilion');
  // Low cover walls mid.
  box(2.4, 1.2, 0.6, -4, 0.6, -3.5, 'stone');
  box(2.4, 1.2, 0.6, 4, 0.6, 3.5, 'stone');
  visualBox(2.4, 0.14, 0.66, -4, 1.26, -3.5, 'vermilion');
  visualBox(2.4, 0.14, 0.66, 4, 1.26, 3.5, 'vermilion');

  // ---- Lanes: A-long (west) and B-long (east) --------------------------------
  box(0.6, 1.4, 4, -19.5, 0.7, 5, 'stone');
  box(0.6, 1.4, 4, -19.5, 0.7, -4, 'stone');
  box(0.6, 1.4, 4, 19.5, 0.7, 5, 'stone');
  box(0.6, 1.4, 4, 19.5, 0.7, -4, 'stone');
  visualBox(0.66, 0.14, 4, -19.5, 1.46, 5, 'vermilion');
  visualBox(0.66, 0.14, 4, -19.5, 1.46, -4, 'vermilion');
  visualBox(0.66, 0.14, 4, 19.5, 1.46, 5, 'vermilion');
  visualBox(0.66, 0.14, 4, 19.5, 1.46, -4, 'vermilion');

  // ---- South Yard (spawn) + scattered cover ----------------------------------
  // Spawn wall: a 3 m stone wall across the yard at z = +10 with three gates
  // (west / mid / east). Defenders holding Mid or the sites cannot see or shoot
  // into the attack spawn; attackers leave through the gates. The gates are
  // waypoints (gateW / gateM / gateE) so bots path through them, never the wall.
  box(2, 3, 0.6, -21, 1.5, 10, 'stone');
  box(14, 3, 0.6, -9, 1.5, 10, 'stone');
  box(14, 3, 0.6, 9, 1.5, 10, 'stone');
  box(2, 3, 0.6, 21, 1.5, 10, 'stone');
  visualBox(2.06, 0.14, 0.66, -21, 3.06, 10, 'vermilion');
  visualBox(14.06, 0.14, 0.66, -9, 3.06, 10, 'vermilion');
  visualBox(14.06, 0.14, 0.66, 9, 3.06, 10, 'vermilion');
  visualBox(2.06, 0.14, 0.66, 21, 3.06, 10, 'vermilion');
  crate(-5, 13.5, 1.2, 0.3);
  crate(5.5, 14, 1.0, -0.2);
  crate(6.4, 13.2, 0.9, 0.5);
  barrel(7, 12.5);
  barrel(-7, 12);
  barrel(-7.8, 12.6);
  crate(-4.5, 6.5, 1.1, 0.1);
  crate(4.5, -3.5, 1.1, -0.4);
  crate(-18.5, -4, 1.2, 0.2);
  crate(18.5, -4, 1.2, -0.3);
  crate(-18, -13, 1.0, 0.4);
  crate(17.5, -12.5, 1.0, 0.1);
  barrel(-16, 8);
  barrel(16.5, 8.5);
  crate(-9, 0.5, 1.0, 0.6);
  crate(9.5, -0.5, 1.0, -0.5);

  // ---- Mist planes + distant mountains (decor, outside the fight) -------------
  function mistPlane(w, h, x, y, z, rotY) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mistMat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    group.add(mesh);
    animators.push({ obj: mesh, baseX: x, baseY: y, phase: rand() * Math.PI * 2, kind: 'drift' });
    return mesh;
  }
  mistPlane(30, 7, 0, 3.5, -17.2, 0);
  mistPlane(30, 7, 0, 3.5, 17.2, Math.PI);
  mistPlane(26, 7, -21.2, 3.5, 0, Math.PI / 2);
  mistPlane(26, 7, 21.2, 3.5, 0, -Math.PI / 2);
  mistPlane(20, 1.2, -8, 2.4, 4, 0.3);
  mistPlane(20, 1.2, 8, 2.6, -3, -0.4);
  function mountain(x, z, r, h) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), mountainMat);
    mesh.position.set(x, h / 2 - 0.5, z);
    group.add(mesh);
    return mesh;
  }
  mountain(-27, -24, 11, 15);
  mountain(-8, -27, 13, 18);
  mountain(12, -26, 10, 13);
  mountain(28, -22, 12, 16);
  mountain(-28, 20, 12, 14);
  mountain(26, 24, 11, 15);
  mountain(0, 27, 13, 12);

  // ---- lighting ---------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(PALETTE.hemiSky), new THREE.Color(PALETTE.hemiGround), 0.9,
  );
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), 2.2);
  sun.position.set(18, 24, 10);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  // ---- nav graph ---------------------------------------------------------------
  const waypoints = new Map([
    ['spawnA', new THREE.Vector3(0, 0, 15)],
    ['spawnD', new THREE.Vector3(0, 0, -15.5)],
    ['aLong', new THREE.Vector3(-19, 0, 0)],
    ['aSite', new THREE.Vector3(-13, 0.5, -11)],
    ['aSteps', new THREE.Vector3(-13, 0, -7)],
    ['mid', new THREE.Vector3(0, 0, 0)],
    ['court', new THREE.Vector3(0, 0, -8.5)],
    ['bLong', new THREE.Vector3(19, 0, 0)],
    ['bSite', new THREE.Vector3(13, 0, -8.5)],
    ['bridge', new THREE.Vector3(13, 0.3, -12.25)],
    ['under', new THREE.Vector3(0, 0, -6)],
    ['southYard', new THREE.Vector3(0, 0, 12)],
    ['yardW', new THREE.Vector3(-18, 0, 12)],
    ['gateW', new THREE.Vector3(-18, 0, 10)],
    ['gateM', new THREE.Vector3(0, 0, 10)],
    ['yardE', new THREE.Vector3(18, 0, 12)],
    ['gateE', new THREE.Vector3(18, 0, 10)],
    ['aHold', new THREE.Vector3(-17, 0, -5)],
    ['bHold', new THREE.Vector3(17, 0, -8)],
    ['midHold', new THREE.Vector3(0, 0, 4)],
  ]);
  const edgePairs = [
    ['spawnA', 'southYard'], ['southYard', 'yardW'], ['yardW', 'gateW'],
    ['gateW', 'aLong'], ['southYard', 'gateM'], ['gateM', 'mid'],
    ['southYard', 'yardE'], ['yardE', 'gateE'], ['gateE', 'bLong'],
    ['aLong', 'aSite'], ['aSite', 'aSteps'],
    ['aSite', 'court'], ['mid', 'court'], ['mid', 'under'], ['court', 'aSite'],
    ['court', 'bSite'], ['bLong', 'bSite'], ['bLong', 'bridge'],
    ['bridge', 'bSite'], ['under', 'court'], ['aLong', 'aHold'],
    ['bLong', 'bHold'], ['mid', 'midHold'],
    // Defenders leave their north spawn through the court and the sites.
    ['spawnD', 'court'], ['spawnD', 'aSite'], ['spawnD', 'bSite'],
  ];
  const edges = new Map();
  for (const name of waypoints.keys()) edges.set(name, []);
  for (const [a, b] of edgePairs) {
    if (!edges.get(a).includes(b)) edges.get(a).push(b);
    if (!edges.get(b).includes(a)) edges.get(b).push(a);
  }

  let time = 0;
  function update(dt) {
    time += dt;
    for (let i = 0; i < animators.length; i++) {
      const a = animators[i];
      if (a.kind === 'bob') {
        a.obj.position.y = a.baseY + Math.sin(time * 1.2 + a.phase) * 0.15;
      } else {
        a.obj.position.x = a.baseX + Math.sin(time * 0.05 + a.phase) * 1.2;
      }
    }
  }

  return {
    colliders,
    shootables,
    sites: {
      A: { center: new THREE.Vector3(-13, 0.5, -11), radius: 2.2 },
      B: { center: new THREE.Vector3(13, 0, -8.5), radius: 2.2 },
    },
    spawns: {
      attack: [
        new THREE.Vector3(-8, 0, 15), new THREE.Vector3(-4, 0, 15.5),
        new THREE.Vector3(0, 0, 15), new THREE.Vector3(4, 0, 15.5),
        new THREE.Vector3(8, 0, 15),
      ],
      defend: [
        new THREE.Vector3(-16, 0, -15), new THREE.Vector3(-8, 0, -15.5),
        new THREE.Vector3(0, 0, -16), new THREE.Vector3(8, 0, -15.5),
        new THREE.Vector3(16, 0, -15),
      ],
    },
    waypoints,
    edges,
    bounds: { minX: -22, maxX: 22, minZ: -18, maxZ: 18 },
    update,
  };
}
