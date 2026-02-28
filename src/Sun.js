import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, color, uniform,
  positionWorld, normalWorld, cameraPosition,
  time, sin, cos, pow, mix, smoothstep,
  normalize, dot, abs
} from 'three/tsl';
import { SUN_RADIUS } from './data/planets.js';

/**
 * Creates the Sun:
 *  - Emissive core sphere (TSL animated noise-like surface)
 *  - Corona glow halo (large transparent sphere, BackSide)
 *  - PointLight at origin
 */
export function createSun(scene) {
  const group = new THREE.Group();
  group.name = 'Sun';

  // ── Core sphere ──────────────────────────────────────
  const coreGeo = new THREE.SphereGeometry(SUN_RADIUS, 64, 64);
  const coreMat = new THREE.MeshStandardNodeMaterial();

  coreMat.colorNode = Fn(() => {
    // Animated swirling plasma-like color
    const p = positionWorld;
    const t = time.mul(0.3);

    // Simple animated banding to mimic solar convection
    const wave1 = sin(p.y.mul(3.0).add(t)).mul(0.5).add(0.5);
    const wave2 = cos(p.x.mul(2.5).sub(t.mul(0.7))).mul(0.5).add(0.5);
    const wave3 = sin(p.z.mul(4.0).add(t.mul(1.3))).mul(0.5).add(0.5);
    const blend  = wave1.mul(wave2).add(wave3.mul(0.3));

    const hotCore    = vec3(1.0, 0.9, 0.3);   // bright yellow-white
    const warmSurface = vec3(1.0, 0.55, 0.05); // deep orange
    const coolSpot   = vec3(0.8, 0.3, 0.02);   // sunspot brown

    const c1 = mix(warmSurface, hotCore, blend.pow(1.5));
    const c2 = mix(c1, coolSpot, wave2.mul(wave1).pow(3.0).mul(0.4));
    return c2;
  })();

  // Fully emissive — the Sun is its own light source
  coreMat.emissiveNode = Fn(() => {
    const p = positionWorld;
    const t = time.mul(0.3);
    const wave1 = sin(p.y.mul(3.0).add(t)).mul(0.5).add(0.5);
    const wave2 = cos(p.x.mul(2.5).sub(t.mul(0.7))).mul(0.5).add(0.5);
    const blend  = wave1.mul(wave2);

    const hotCore     = vec3(1.0, 0.85, 0.2);
    const warmSurface = vec3(0.9, 0.45, 0.0);
    return mix(warmSurface, hotCore, blend).mul(1.5);
  })();

  coreMat.roughnessNode = float(1.0);
  coreMat.metalnessNode = float(0.0);

  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  // ── Corona / glow ────────────────────────────────────
  const coronaGeo = new THREE.SphereGeometry(SUN_RADIUS * 1.6, 32, 32);
  const coronaMat = new THREE.MeshBasicNodeMaterial();

  coronaMat.colorNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nDotV   = abs(normalWorld.dot(viewDir));
    const fresnel = float(1.0).sub(nDotV).pow(3.5);
    // Pulsing brightness
    const pulse = sin(time.mul(0.8)).mul(0.15).add(0.85);
    return vec3(1.0, 0.65, 0.1).mul(fresnel).mul(pulse);
  })();

  coronaMat.opacityNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nDotV   = abs(normalWorld.dot(viewDir));
    return float(1.0).sub(nDotV).pow(2.5).mul(0.7);
  })();

  coronaMat.transparent = true;
  coronaMat.depthWrite  = false;
  coronaMat.side        = THREE.BackSide;

  const corona = new THREE.Mesh(coronaGeo, coronaMat);
  group.add(corona);

  // ── Outer soft glow ──────────────────────────────────
  const outerGeo = new THREE.SphereGeometry(SUN_RADIUS * 2.8, 32, 32);
  const outerMat = new THREE.MeshBasicNodeMaterial();

  outerMat.colorNode = Fn(() => {
    return vec3(1.0, 0.6, 0.1);
  })();

  outerMat.opacityNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nDotV   = abs(normalWorld.dot(viewDir));
    return float(1.0).sub(nDotV).pow(4.0).mul(0.25);
  })();

  outerMat.transparent = true;
  outerMat.depthWrite  = false;
  outerMat.side        = THREE.BackSide;

  const outer = new THREE.Mesh(outerGeo, outerMat);
  group.add(outer);

  // ── Lighting ─────────────────────────────────────────
  // Main point light — illuminates all planets
  const sunLight = new THREE.PointLight(0xfff5e0, 3.0, 0, 1.2);
  group.add(sunLight);

  // Very faint ambient so the dark sides aren't pure black
  const ambient = new THREE.AmbientLight(0x111133, 0.25);
  scene.add(ambient);

  scene.add(group);
  return { group, core, sunLight };
}
