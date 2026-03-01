import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3,
  positionWorld, normalWorld, cameraPosition,
  time, sin, cos, pow, mix,
  normalize, abs,
  texture as texNode,
} from 'three/tsl';
import { SUN_RADIUS, SUN_DATA } from './data/planets.js';

const sunTex = new THREE.TextureLoader().load('/src/assets/2k_sun.jpg');
sunTex.colorSpace = THREE.SRGBColorSpace;

/**
 * Creates the Sun:
 *  - Emissive core sphere (TSL animated plasma surface)
 *  - Multiple corona glow halos
 *  - Strong PointLight + fill light
 */
export function createSun(scene) {
  const group = new THREE.Group();
  group.name = 'Sun';

  // ── Core sphere ──────────────────────────────────────
  const coreGeo = new THREE.SphereGeometry(SUN_RADIUS, 64, 64);
  const coreMat = new THREE.MeshStandardNodeMaterial();

  coreMat.colorNode = Fn(() => {
    const p    = positionWorld;
    const t    = time.mul(0.4);
    const base = texNode(sunTex).rgb; // real NASA sun texture

    // Animated plasma overlay
    const wave1 = sin(p.y.mul(4.0).add(t)).mul(0.5).add(0.5);
    const wave2 = cos(p.x.mul(3.0).sub(t.mul(0.7))).mul(0.5).add(0.5);
    const wave3 = sin(p.z.mul(5.0).add(t.mul(1.5))).mul(0.5).add(0.5);
    const wave4 = cos(p.y.mul(8.0).sub(p.x.mul(3.0)).add(t.mul(0.3))).mul(0.5).add(0.5);
    const blend  = wave1.mul(wave2).add(wave3.mul(0.4)).add(wave4.mul(0.2));

    const hotCore     = vec3(1.0, 0.98, 0.6);
    const warmSurface = vec3(1.0, 0.62, 0.05);
    const coolSpot    = vec3(0.7, 0.25, 0.01);
    const plasma = mix(mix(warmSurface, hotCore, blend.pow(1.2)), coolSpot, wave2.mul(wave1).pow(4.0).mul(0.35));

    // 65% real texture + 35% animated plasma
    return mix(base, plasma, float(0.35));
  })();

  // Fully emissive — the Sun radiates its own intense light
  coreMat.emissiveNode = Fn(() => {
    const p    = positionWorld;
    const t    = time.mul(0.4);
    const base = texNode(sunTex).rgb;
    const wave1 = sin(p.y.mul(4.0).add(t)).mul(0.5).add(0.5);
    const wave2 = cos(p.x.mul(3.0).sub(t.mul(0.7))).mul(0.5).add(0.5);
    const wave3 = sin(p.z.mul(5.0).add(t.mul(1.5))).mul(0.5).add(0.5);
    const blend  = wave1.mul(wave2).add(wave3.mul(0.3));

    const hotCore     = vec3(1.0, 0.92, 0.5);
    const warmSurface = vec3(1.0, 0.55, 0.05);
    const plasma      = mix(warmSurface, hotCore, blend);

    // Blend texture + plasma emissive, multiplied for brightness
    return mix(base, plasma, float(0.4)).mul(5.0);
  })();

  coreMat.roughnessNode = float(1.0);
  coreMat.metalnessNode = float(0.0);

  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  // ── Hover glow (shown when the Sun is hovered / selected) ───────
  const sunHoverGlow = createSunHoverGlow(SUN_RADIUS);
  group.add(sunHoverGlow);

  // ── userData so the group carries Sun info ────────────────────
  group.userData = SUN_DATA;
  core.userData  = SUN_DATA;

  // ── Lighting ─────────────────────────────────────────
  // Intensity scaled for DIST_SCALE = 160 (Earth now at 160 units).
  // Target: same relative brightness at Earth as the old setup.
  // Formula: new_i = old_i × (new_dist / old_dist)^decay = 280 × (160/12)^1.5 ≈ 13 600
  const sunLight = new THREE.PointLight(0xfffae8, 14000, 0, 1.5);
  group.add(sunLight);

  // Secondary fill — slightly cooler tone to reduce pure-black shadows
  const fillLight = new THREE.PointLight(0xff9030, 2500, 0, 2.0);
  group.add(fillLight);

  // Gentle ambient so the dark sides of planets aren't pitch black
  const ambient = new THREE.AmbientLight(0x0d1428, 0.6);
  scene.add(ambient);

  scene.add(group);
  return { group, core, sunLight, sunHoverGlow };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sun hover glow — golden rim, shown on hover/select
// ─────────────────────────────────────────────────────────────────────────────

function createSunHoverGlow(radius) {
  const geo = new THREE.SphereGeometry(radius * 1.18, 32, 32);
  const mat = new THREE.MeshBasicNodeMaterial();

  mat.colorNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim     = float(1.0).sub(abs(normalWorld.dot(viewDir))).pow(2.0);
    const pulse   = sin(time.mul(2.0)).mul(0.2).add(0.8);
    return vec3(1.0, 0.72, 0.2).mul(rim).mul(pulse);
  })();

  mat.opacityNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim     = float(1.0).sub(abs(normalWorld.dot(viewDir))).pow(1.8);
    const pulse   = sin(time.mul(2.0)).mul(0.15).add(0.65);
    return rim.mul(pulse).mul(0.7);
  })();

  mat.transparent = true;
  mat.depthWrite  = false;
  mat.side        = THREE.BackSide;

  const mesh   = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.name    = 'sunHoverGlow';
  return mesh;
}
