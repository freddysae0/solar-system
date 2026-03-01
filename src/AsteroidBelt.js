import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, uniform,
  positionWorld, normalWorld, cameraPosition,
  normalize, abs, mix, sin, cos, time
} from 'three/tsl';
import { DIST_SCALE, ASTEROID_BELT, METEOR_COUNT } from './data/planets.js';

const DEG = Math.PI / 180;

/**
 * Creates the asteroid belt as InstancedMesh for performance,
 * plus a small set of "meteors" (moving streaks).
 */
export function createAsteroidBelt(scene) {
  const { innerAU, outerAU, count, color: beltColor } = ASTEROID_BELT;
  const innerR = innerAU * DIST_SCALE;
  const outerR = outerAU * DIST_SCALE;

  // ── Static belt (InstancedMesh) ──────────────────────────────────
  const geo = buildAsteroidGeo();
  const mat = new THREE.MeshStandardNodeMaterial();

  const col = new THREE.Color(beltColor);
  mat.colorNode = Fn(() => {
    return vec3(col.r, col.g, col.b).mul(0.8);
  })();
  mat.roughnessNode = float(0.95);
  mat.metalnessNode = float(0.1);

  const belt = new THREE.InstancedMesh(geo, mat, count);
  belt.name = 'AsteroidBelt';

  const dummy    = new THREE.Object3D();
  const angData  = new Float32Array(count); // per-instance orbital angle
  const speedData = new Float32Array(count);
  const radiusData = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r     = innerR + Math.random() * (outerR - innerR);
    const angle = Math.random() * Math.PI * 2;
    const yOff  = (Math.random() - 0.5) * 1.5; // slight vertical scatter
    const scale = 0.015 + Math.random() * 0.06;

    dummy.position.set(
      r * Math.cos(angle),
      yOff,
      r * Math.sin(angle)
    );
    dummy.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    belt.setMatrixAt(i, dummy.matrix);

    angData[i]    = angle;
    speedData[i]  = 0.00015 + Math.random() * 0.0001; // orbital speed
    radiusData[i] = r;
  }

  belt.instanceMatrix.needsUpdate = true;
  belt.userData = { angData, speedData, radiusData, yOffsets: Array.from({ length: count }, () => (Math.random() - 0.5) * 1.5) };
  scene.add(belt);

  // ── Meteors (line streaks that move across the scene) ────────────
  const meteors = createMeteors(scene);

  return { belt, meteors };
}

/**
 * Updates asteroid belt rotation each frame.
 * @param {THREE.InstancedMesh} belt
 * @param {number} delta - seconds elapsed
 * @param {number} speedMult - time multiplier
 */
export function updateAsteroidBelt(belt, delta, speedMult) {
  const { angData, speedData, radiusData, yOffsets } = belt.userData;
  const dummy = new THREE.Object3D();
  const count = angData.length;

  for (let i = 0; i < count; i++) {
    angData[i] += speedData[i] * delta * speedMult;
    const r = radiusData[i];
    const a = angData[i];

    dummy.position.set(r * Math.cos(a), yOffsets[i], r * Math.sin(a));
    // Keep scale & rotation from matrix (extract first time if needed)
    belt.getMatrixAt(i, dummy.matrix);
    // Overwrite position only (preserve rotation/scale)
    dummy.matrix.setPosition(r * Math.cos(a), yOffsets[i], r * Math.sin(a));
    belt.setMatrixAt(i, dummy.matrix);
  }
  belt.instanceMatrix.needsUpdate = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Random irregular asteroid geometry
// ─────────────────────────────────────────────────────────────────────────────

function buildAsteroidGeo() {
  const base = new THREE.DodecahedronGeometry(1, 0);
  const pos  = base.attributes.position;

  // Randomly displace vertices to make it irregular
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) * (0.7 + Math.random() * 0.6),
      pos.getY(i) * (0.7 + Math.random() * 0.6),
      pos.getZ(i) * (0.7 + Math.random() * 0.6),
    );
  }
  pos.needsUpdate = true;
  base.computeVertexNormals();
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Meteors — bright streaks crossing the system
// ─────────────────────────────────────────────────────────────────────────────

function createMeteors(scene) {
  const meteors = [];

  for (let i = 0; i < METEOR_COUNT; i++) {
    const meteor = spawnMeteor();
    scene.add(meteor.line);
    meteors.push(meteor);
  }

  return meteors;
}

function spawnMeteor(existingMeteor) {
  // Random origin far out in the system — scaled for DIST_SCALE = 160
  const outerR = DIST_SCALE * 12; // ~1920 units, near Uranus orbit
  const theta  = Math.random() * Math.PI * 2;
  const phi    = (Math.random() - 0.5) * 0.3; // near ecliptic

  const startPos = new THREE.Vector3(
    outerR * Math.cos(theta) * Math.cos(phi),
    outerR * Math.sin(phi),
    outerR * Math.sin(theta) * Math.cos(phi)
  );

  // Aim roughly toward the inner solar system with some scatter
  const target = new THREE.Vector3(
    (Math.random() - 0.5) * DIST_SCALE * 2.5,
    (Math.random() - 0.5) * DIST_SCALE * 0.8,
    (Math.random() - 0.5) * DIST_SCALE * 2.5
  );

  const dir = target.clone().sub(startPos).normalize();
  const speed  = 100 + Math.random() * 200;    // units/second (scaled for larger scene)
  const length = 20  + Math.random() * 40;     // trail length (scaled)

  // Line geometry: two points (tail → head)
  const points = [startPos.clone(), startPos.clone().addScaledVector(dir, -length)];
  const geo    = new THREE.BufferGeometry().setFromPoints(points);

  const mat = new THREE.LineBasicNodeMaterial();
  mat.colorNode = Fn(() => vec3(0.9, 0.95, 1.0))();
  mat.opacityNode = Fn(() => float(0.85))();
  mat.transparent = true;

  const line = new THREE.Line(geo, mat);
  line.name = 'Meteor';

  return {
    line,
    startPos: startPos.clone(),
    dir,
    speed,
    length,
    traveled: 0,
    maxDist: startPos.length() * 2 + 50,
  };
}

export function updateMeteors(meteors, delta, speedMult, scene) {
  const dummy = new THREE.Object3D();

  for (let i = 0; i < meteors.length; i++) {
    const m = meteors[i];
    const dist = m.speed * delta * speedMult;
    m.traveled += dist;

    // Advance the line
    const pos = m.line.geometry.attributes.position;
    // head
    pos.setXYZ(0,
      pos.getX(0) + m.dir.x * dist,
      pos.getY(0) + m.dir.y * dist,
      pos.getZ(0) + m.dir.z * dist,
    );
    // tail
    pos.setXYZ(1,
      pos.getX(0) - m.dir.x * m.length,
      pos.getY(0) - m.dir.y * m.length,
      pos.getZ(0) - m.dir.z * m.length,
    );
    pos.needsUpdate = true;

    // Respawn when it leaves the scene
    if (m.traveled > m.maxDist) {
      scene.remove(m.line);
      const fresh = spawnMeteor();
      scene.add(fresh.line);
      meteors[i] = fresh;
    }
  }
}
