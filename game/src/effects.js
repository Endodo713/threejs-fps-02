// Pooled shot effects: tracers, muzzle flash, impact sparks, smoke puffs.
// Everything is preallocated at build time; step() only writes numbers into
// existing buffers, so the hot loop allocates nothing.
import * as THREE from 'three';

const TRACER_COUNT = 24;
const TRACER_LIFE = 0.08;
const SPARK_COUNT = 40;
const MUZZLE_LIFE = 0.04;
const SMOKE_COUNT = 6;

// Deterministic rng for spark directions (no Math.random in sim code).
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

function flashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 240, 200, 1)');
  grad.addColorStop(0.4, 'rgba(255, 200, 90, 0.7)');
  grad.addColorStop(1, 'rgba(255, 180, 60, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createEffects(scene) {
  const rand = mulberry32(20261115);

  // ---- tracers: 24 reusable 2-point lines ----------------------------------
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffe9b0, transparent: true, opacity: 0, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  // ---- sparks: one Points cloud, 40 pooled particles ------------------------
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  const sparkVel = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  for (let i = 0; i < SPARK_COUNT; i++) sparkPos[i * 3 + 1] = -999;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    color: 0xffc860, size: 0.14, sizeAttenuation: true,
    transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);
  let sparkCursor = 0;

  // ---- muzzle flash: one additive sprite, shown 40 ms per shot --------------
  const muzzleMat = new THREE.SpriteMaterial({
    map: flashTexture(), color: 0xffe0a8, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const muzzleSprite = new THREE.Sprite(muzzleMat);
  muzzleSprite.visible = false;
  muzzleSprite.scale.set(0.22, 0.22, 1);
  scene.add(muzzleSprite);
  let muzzleLife = 0;

  // ---- smoke: 6 reusable translucent spheres --------------------------------
  const smokeGeo = new THREE.SphereGeometry(1, 12, 8);
  const smokes = [];
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcfd8cc, transparent: true, opacity: 0, depthWrite: false,
    });
    const mesh = new THREE.Mesh(smokeGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    smokes.push({ mesh, life: 0, ttl: 1, radius: 1 });
  }
  let smokeCursor = 0;

  // Preallocated temps — step() and the emitters reuse these, never `new`.
  const tmp = new THREE.Vector3();

  function tracer(from, to) {
    const slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
    const p = slot.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    slot.line.geometry.attributes.position.needsUpdate = true;
    slot.line.material.opacity = 1;
    slot.line.visible = true;
    slot.life = TRACER_LIFE;
  }

  function muzzle(pos, dir) {
    tmp.copy(pos).addScaledVector(dir, 0.35);
    muzzleSprite.position.copy(tmp);
    muzzleSprite.visible = true;
    muzzleLife = MUZZLE_LIFE;
  }

  function sparks(pos, n) {
    for (let k = 0; k < n; k++) {
      const i = sparkCursor;
      sparkCursor = (sparkCursor + 1) % SPARK_COUNT;
      const i3 = i * 3;
      sparkPos[i3] = pos.x;
      sparkPos[i3 + 1] = pos.y;
      sparkPos[i3 + 2] = pos.z;
      // Random direction on a sphere, speed 3–7 m/s.
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const speed = 3 + rand() * 4;
      sparkVel[i3] = s * Math.cos(a) * speed;
      sparkVel[i3 + 1] = u * speed + 2;
      sparkVel[i3 + 2] = s * Math.sin(a) * speed;
      sparkLife[i] = 0.3 + rand() * 0.3;
    }
    sparkGeo.attributes.position.needsUpdate = true;
  }

  function smoke(pos, r, ttl) {
    const slot = smokes[smokeCursor];
    smokeCursor = (smokeCursor + 1) % SMOKE_COUNT;
    slot.mesh.position.copy(pos);
    slot.mesh.scale.set(r, r, r);
    slot.mesh.material.opacity = 0.35;
    slot.mesh.visible = true;
    slot.life = ttl;
    slot.ttl = ttl;
    slot.radius = r;
  }

  function step(dt) {
    for (let i = 0; i < TRACER_COUNT; i++) {
      const slot = tracers[i];
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.line.visible = false;
        slot.line.material.opacity = 0;
      } else {
        slot.line.material.opacity = slot.life / TRACER_LIFE;
      }
    }
    if (muzzleLife > 0) {
      muzzleLife -= dt;
      if (muzzleLife <= 0) muzzleSprite.visible = false;
    }
    let sparkMoved = false;
    for (let i = 0; i < SPARK_COUNT; i++) {
      if (sparkLife[i] <= 0) continue;
      sparkMoved = true;
      sparkLife[i] -= dt;
      const i3 = i * 3;
      if (sparkLife[i] <= 0) {
        sparkPos[i3 + 1] = -999;
        continue;
      }
      sparkVel[i3 + 1] -= 9.8 * dt;
      sparkPos[i3] += sparkVel[i3] * dt;
      sparkPos[i3 + 1] += sparkVel[i3 + 1] * dt;
      sparkPos[i3 + 2] += sparkVel[i3 + 2] * dt;
    }
    if (sparkMoved) sparkGeo.attributes.position.needsUpdate = true;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const slot = smokes[i];
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.mesh.visible = false;
        slot.mesh.material.opacity = 0;
      } else {
        const grown = slot.radius * (1 + (1 - slot.life / slot.ttl) * 0.15);
        slot.mesh.scale.set(grown, grown, grown);
        slot.mesh.material.opacity = 0.35 * (slot.life / slot.ttl);
      }
    }
  }

  function reset() {
    for (let i = 0; i < TRACER_COUNT; i++) {
      tracers[i].life = 0;
      tracers[i].line.visible = false;
      tracers[i].line.material.opacity = 0;
    }
    for (let i = 0; i < SPARK_COUNT; i++) {
      sparkLife[i] = 0;
      sparkPos[i * 3 + 1] = -999;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    muzzleLife = 0;
    muzzleSprite.visible = false;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      smokes[i].life = 0;
      smokes[i].mesh.visible = false;
      smokes[i].mesh.material.opacity = 0;
    }
  }

  return { tracer, muzzle, sparks, smoke, step, reset };
}
