import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vec2, color, uniform,
  positionWorld, normalWorld, cameraPosition,
  time, sin, cos, mix, smoothstep, pow,
  normalize, dot, abs, uv, attribute
} from 'three/tsl';
import { DIST_SCALE, SIZE_SCALE } from './data/planets.js';

const DEG = Math.PI / 180;

/**
 * Creates a planet mesh + orbit ring + optional rings/atmosphere.
 * Mesh is added directly to the scene; position updated each frame
 * via getOrbitalPosition() which already accounts for inclination.
 */
export function createPlanet(data, scene) {
  const radius = data.radiusKm * SIZE_SCALE;
  const distAU = data.distanceAU * DIST_SCALE;
  const ecc    = data.eccentricity;

  // ── Axial-tilt wrapper ────────────────────────────────────────────
  // Wrap the sphere in a group so rotation.z (tilt) doesn't fight
  // with the y-axis spin we apply each frame.
  const tiltGroup = new THREE.Group();
  tiltGroup.name  = data.name;
  tiltGroup.userData = data;

  // ── Planet sphere ─────────────────────────────────────────────────
  const geo = new THREE.SphereGeometry(radius, 48, 48);
  const mat = buildPlanetMaterial(data, radius);
  const sphere = new THREE.Mesh(geo, mat);
  sphere.castShadow    = true;
  sphere.receiveShadow = true;

  // Axial tilt on the inner sphere (Uranus extreme, others gentle)
  sphere.rotation.z = (data.axialTiltDeg ?? 20 + Math.random() * 15) * DEG;

  tiltGroup.add(sphere);

  // ── Saturn / Uranus rings ─────────────────────────────────────────
  if (data.rings) {
    tiltGroup.add(createRings(data, radius));
  }

  // ── Atmosphere glow ───────────────────────────────────────────────
  if (data.hasAtmosphere) {
    tiltGroup.add(createAtmosphere(radius, data.atmosphereColor ?? 0x4db2ff));
  }

  // ── Hover selection ring ──────────────────────────────────────────
  const hoverGlow = createHoverGlow(radius);
  tiltGroup.add(hoverGlow);

  scene.add(tiltGroup);

  // ── Orbit path line ───────────────────────────────────────────────
  const orbitLine = createOrbitPath(distAU, ecc, data.inclinationDeg);

  return {
    mesh: tiltGroup,
    sphere,
    hoverGlow,
    orbitLine,
    data,
    radius,
    distAU,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Planet material — TSL procedural shading
// ─────────────────────────────────────────────────────────────────────────────

function buildPlanetMaterial(data, radius) {
  const mat = new THREE.MeshStandardNodeMaterial();

  const baseColor = new THREE.Color(data.color);
  const emColor   = new THREE.Color(data.emissive);

  // ── Jupiter banded look ────────────────────────────────────────────
  if (data.hasBands) {
    const bandCols = data.bandColors.map(c => new THREE.Color(c));

    mat.colorNode = Fn(() => {
      const ny = normalWorld.y.mul(0.5).add(0.5); // 0..1 from south to north
      const t  = time.mul(0.008);

      // Multiple band frequencies
      const b1 = sin(ny.mul(18.0).add(t)).mul(0.5).add(0.5);
      const b2 = sin(ny.mul(28.0).sub(t.mul(1.3))).mul(0.5).add(0.5);
      const b3 = cos(ny.mul(8.0).add(t.mul(0.5))).mul(0.5).add(0.5);

      const c0 = vec3(bandCols[0].r, bandCols[0].g, bandCols[0].b);
      const c1 = vec3(bandCols[1].r, bandCols[1].g, bandCols[1].b);
      const c2 = vec3(bandCols[2].r, bandCols[2].g, bandCols[2].b);
      const c3 = vec3(bandCols[3].r, bandCols[3].g, bandCols[3].b);

      const m1 = mix(c0, c1, b1);
      const m2 = mix(m1, c2, b2.mul(0.6));
      return  mix(m2, c3, b3.mul(0.3));
    })();

  } else if (data.name === 'Earth') {
    // Earth: ocean + land procedural blend
    mat.colorNode = Fn(() => {
      const p  = positionWorld.normalize();
      const t  = time.mul(0.015);

      // Fake "continent" pattern using trig
      const land  = sin(p.x.mul(8.0).add(t)).mul(cos(p.z.mul(7.0))).mul(0.5).add(0.5);
      const ocean = vec3(0.08, 0.25, 0.62);
      const cont  = vec3(0.22, 0.48, 0.18);
      const snow  = vec3(0.85, 0.88, 0.90);

      const isLand = smoothstep(0.45, 0.55, land);
      const isPole = abs(p.y).smoothstep(0.7, 0.95);

      const base = mix(ocean, cont, isLand);
      return mix(base, snow, isPole);
    })();

  } else {
    // Default: solid color with slight noise texture variation
    mat.colorNode = Fn(() => {
      const p   = positionWorld.normalize();
      const t   = time.mul(0.02);
      const n   = sin(p.x.mul(5.0).add(t)).mul(cos(p.y.mul(4.0))).mul(sin(p.z.mul(6.0))).mul(0.08);
      const col = vec3(baseColor.r, baseColor.g, baseColor.b);
      return col.add(n);
    })();
  }

  mat.emissiveNode = Fn(() => {
    return vec3(emColor.r, emColor.g, emColor.b);
  })();

  mat.roughnessNode = float(data.roughness);
  mat.metalnessNode = float(data.metalness);

  return mat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rings (Saturn / Uranus)
// ─────────────────────────────────────────────────────────────────────────────

function createRings(data, planetRadius) {
  const inner = planetRadius * data.ringInnerR;
  const outer = planetRadius * data.ringOuterR;

  const geo = new THREE.RingGeometry(inner, outer, 128, 4);

  // UV the ring so we can make concentric bands
  const pos  = geo.attributes.position;
  const uvs  = new Float32Array(pos.count * 2);
  const v3   = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    const r   = Math.sqrt(v3.x * v3.x + v3.z * v3.z);
    const t   = (r - inner) / (outer - inner);
    uvs[i * 2]     = t;
    uvs[i * 2 + 1] = t;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  const ringColor = new THREE.Color(data.ringColor);
  const mat = new THREE.MeshStandardNodeMaterial();

  mat.colorNode = Fn(() => {
    const t    = uv().x; // 0 = inner, 1 = outer
    const band = sin(t.mul(60.0)).mul(0.5).add(0.5);
    const col  = vec3(ringColor.r, ringColor.g, ringColor.b);
    return col.mul(band.mul(0.4).add(0.6));
  })();

  mat.opacityNode = Fn(() => {
    const t    = uv().x;
    const band = sin(t.mul(60.0)).mul(0.5).add(0.5);
    return band.mul(0.5).add(0.2).mul(float(data.ringOpacity));
  })();

  mat.transparent = true;
  mat.depthWrite  = false;
  mat.side        = THREE.DoubleSide;
  mat.roughnessNode = float(0.9);
  mat.metalnessNode = float(0.0);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.name = `${data.name}_rings`;
  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere glow
// ─────────────────────────────────────────────────────────────────────────────

function createAtmosphere(radius, hexColor) {
  const geo = new THREE.SphereGeometry(radius * 1.08, 32, 32);
  const mat = new THREE.MeshBasicNodeMaterial();

  const atmoColor = new THREE.Color(hexColor);

  mat.colorNode = Fn(() => {
    return vec3(atmoColor.r, atmoColor.g, atmoColor.b);
  })();

  mat.opacityNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nDotV   = abs(normalWorld.dot(viewDir));
    return float(1.0).sub(nDotV).pow(3.0).mul(0.6);
  })();

  mat.transparent = true;
  mat.depthWrite  = false;
  mat.side        = THREE.BackSide;

  return new THREE.Mesh(geo, mat);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover selection glow
// ─────────────────────────────────────────────────────────────────────────────

function createHoverGlow(radius) {
  const geo = new THREE.SphereGeometry(radius * 1.22, 32, 32);
  const mat = new THREE.MeshBasicNodeMaterial();

  mat.colorNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim = float(1.0).sub(abs(normalWorld.dot(viewDir))).pow(2.0);
    // Animate pulse
    const pulse = sin(time.mul(3.0)).mul(0.2).add(0.8);
    return vec3(0.35, 0.75, 1.0).mul(rim).mul(pulse);
  })();

  mat.opacityNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim   = float(1.0).sub(abs(normalWorld.dot(viewDir))).pow(1.8);
    const pulse = sin(time.mul(3.0)).mul(0.15).add(0.7);
    return rim.mul(pulse).mul(0.9);
  })();

  mat.transparent = true;
  mat.depthWrite  = false;
  mat.side        = THREE.BackSide;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.name    = 'hoverGlow';
  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orbit path line (ellipse)
// ─────────────────────────────────────────────────────────────────────────────

export function createOrbitPath(semiMajorAU, eccentricity, inclinationDeg) {
  const a = semiMajorAU;                // semi-major axis
  const b = a * Math.sqrt(1 - eccentricity ** 2); // semi-minor axis
  const c = a * eccentricity;           // focal offset

  const points = [];
  const SEG = 256;
  for (let i = 0; i <= SEG; i++) {
    const theta = (i / SEG) * Math.PI * 2;
    // Ellipse centered on focus (Sun at origin)
    const x = a * Math.cos(theta) - c;
    const z = b * Math.sin(theta);
    points.push(new THREE.Vector3(x, 0, z));
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicNodeMaterial();

  mat.colorNode = Fn(() => {
    return vec3(0.3, 0.45, 0.7);
  })();
  mat.opacityNode = Fn(() => float(0.25))();
  mat.transparent = true;

  const line = new THREE.Line(geo, mat);
  line.rotation.x = inclinationDeg * DEG;
  line.name = 'orbit_path';
  return line;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orbital position (Kepler simplified — circular with eccentricity offset)
// ─────────────────────────────────────────────────────────────────────────────

export function getOrbitalPosition(data, elapsedDays) {
  const a   = data.distanceAU * DIST_SCALE;
  const ecc = data.eccentricity;
  const b   = a * Math.sqrt(1 - ecc * ecc);
  const c   = a * ecc;

  const period   = data.periodDays;
  const meanAnom = ((elapsedDays % period) / period) * Math.PI * 2;

  // Solve Kepler's equation iteratively (E - e·sin(E) = M)
  let E = meanAnom;
  for (let i = 0; i < 5; i++) {
    E = meanAnom + ecc * Math.sin(E);
  }

  const x = a * Math.cos(E) - c;
  const z = b * Math.sin(E);

  // Apply inclination
  const inc = data.inclinationDeg * DEG;
  return new THREE.Vector3(x, z * Math.sin(inc), z * Math.cos(inc));
}
