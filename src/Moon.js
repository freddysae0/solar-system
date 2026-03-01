import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3,
  positionWorld, normalWorld, cameraPosition,
  time, sin,
  normalize, abs,
  texture as texNode,
} from 'three/tsl';
import { SIZE_SCALE } from './data/planets.js';

// Minimum visual radius so tiny moons remain clickable
const MIN_DISPLAY_RADIUS = 0.08;

import moonImg from './assets/2k_moon.jpg';

const loader = new THREE.TextureLoader();
const MOON_TEX = loader.load(
  moonImg,
  undefined, undefined,
  () => console.warn('[Solar System] Moon texture failed to load'),
);
MOON_TEX.colorSpace = THREE.SRGBColorSpace;

// ─────────────────────────────────────────────────────────────────────────────
// createMoon — main entry point
// ─────────────────────────────────────────────────────────────────────────────

export function createMoon(moonData, parentPlanet, scene) {
  const rawRadius = moonData.radiusKm * SIZE_SCALE;
  const radius = Math.max(rawRadius, MIN_DISPLAY_RADIUS);

  const geo = new THREE.SphereGeometry(radius, 32, 32);
  const mat = buildMoonMaterial(moonData, radius);
  const sphere = new THREE.Mesh(geo, mat);
  sphere.castShadow = true;
  sphere.name = moonData.name;

  const hoverGlow = createMoonHoverGlow(radius);

  const group = new THREE.Group();
  group.name = moonData.name;
  group.add(sphere);
  group.add(hoverGlow);
  scene.add(group);

  const orbitRadius = moonData.distancePlanetKm * SIZE_SCALE;
  // Retrograde moons (negative period) handled naturally via negative orbitSpeed
  const orbitSpeed = (2 * Math.PI) / Math.abs(moonData.periodDays)
    * (moonData.periodDays < 0 ? -1 : 1);

  return {
    mesh: group,
    sphere,
    hoverGlow,
    data: moonData,
    radius,
    orbitRadius,
    parentPlanet,
    isMoon: true,
    orbitAngle: Math.random() * Math.PI * 2,
    orbitSpeed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Materials
// ─────────────────────────────────────────────────────────────────────────────

function buildMoonMaterial(moonData, radius) {
  const mat = new THREE.MeshStandardNodeMaterial();

  // Earth's Moon gets the real texture; all others get a procedural color
  if (moonData.name === 'Moon') {
    mat.colorNode = texNode(MOON_TEX);
  } else {
    const base = new THREE.Color(moonData.color);
    mat.colorNode = Fn(() => {
      const p = positionWorld.normalize();
      const n = sin(p.x.mul(4.0).add(time.mul(0.01)))
        .mul(sin(p.z.mul(5.0)))
        .mul(0.06);
      return vec3(base.r, base.g, base.b).add(n);
    })();
  }

  mat.roughnessNode = float(moonData.roughness ?? 0.9);
  mat.metalnessNode = float(moonData.metalness ?? 0.02);
  return mat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover glow  (same logic as Planet.js)
// ─────────────────────────────────────────────────────────────────────────────

function createMoonHoverGlow(radius) {
  const geo = new THREE.SphereGeometry(radius * 1.35, 24, 24);
  const mat = new THREE.MeshBasicNodeMaterial();

  mat.colorNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim = float(1.0).sub(abs(normalWorld.dot(viewDir))).pow(2.0);
    const pulse = sin(time.mul(3.0)).mul(0.2).add(0.8);
    return vec3(0.35, 0.75, 1.0).mul(rim).mul(pulse);
  })();

  mat.opacityNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim = float(1.0).sub(abs(normalWorld.dot(viewDir))).pow(1.8);
    const pulse = sin(time.mul(3.0)).mul(0.15).add(0.7);
    return rim.mul(pulse).mul(0.9);
  })();

  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.BackSide;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.name = 'moonHoverGlow';
  return mesh;
}
