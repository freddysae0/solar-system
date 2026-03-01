import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3,
  positionWorld, normalWorld, cameraPosition,
  time, sin, cos, mix, smoothstep, pow,
  normalize, abs, uv,
  texture as texNode,
} from 'three/tsl';
import { DIST_SCALE, SIZE_SCALE } from './data/planets.js';

const DEG = Math.PI / 180;

// ─────────────────────────────────────────────────────────────────────────────
// Texture preloading
// ─────────────────────────────────────────────────────────────────────────────

const loader = new THREE.TextureLoader();

function loadTex(path, srgb = true) {
  const t = loader.load(
    path,
    undefined,
    undefined,
    (err) => console.warn(`[Solar System] Texture failed: ${path}`, err)
  );
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

import sunImg from './assets/2k_sun.jpg';
import mercuryImg from './assets/2k_mercury.jpg';
import venusImg from './assets/2k_venus_surface.jpg';
import earthDayImg from './assets/2k_earth_daymap.jpg';
import earthNightImg from './assets/2k_earth_nightmap.jpg';
import earthCloudsImg from './assets/2k_earth_clouds.jpg';
import marsImg from './assets/2k_mars.jpg';
import jupiterImg from './assets/2k_jupiter.jpg';
import saturnImg from './assets/2k_saturn.jpg';
import saturnRingAlphaImg from './assets/2k_saturn_ring_alpha.png';
import uranusImg from './assets/2k_uranus.jpg';
import neptuneImg from './assets/2k_neptune.jpg';

// Pre-load all planet textures at module init time
const TEX = {
  Sun: { map: loadTex(sunImg) },
  Mercury: { map: loadTex(mercuryImg) },
  Venus: { map: loadTex(venusImg) },
  Earth: {
    day: loadTex(earthDayImg),
    night: loadTex(earthNightImg),
    clouds: loadTex(earthCloudsImg, false),
  },
  Mars: { map: loadTex(marsImg) },
  Jupiter: { map: loadTex(jupiterImg) },
  Saturn: {
    map: loadTex(saturnImg),
    ringAlpha: loadTex(saturnRingAlphaImg, false),
  },
  Uranus: { map: loadTex(uranusImg) },
  Neptune: { map: loadTex(neptuneImg) },
};

export { TEX as PLANET_TEXTURES };

// ─────────────────────────────────────────────────────────────────────────────
// createPlanet — main entry point
// ─────────────────────────────────────────────────────────────────────────────

export function createPlanet(data, scene) {
  const radius = data.radiusKm * SIZE_SCALE;
  const distAU = data.distanceAU * DIST_SCALE;
  const ecc = data.eccentricity;

  // Axial-tilt wrapper
  const tiltGroup = new THREE.Group();
  tiltGroup.name = data.name;
  tiltGroup.userData = data;

  // Planet sphere
  const geo = new THREE.SphereGeometry(radius, 64, 64);
  const mat = buildPlanetMaterial(data, radius);
  const sphere = new THREE.Mesh(geo, mat);
  sphere.castShadow = true;
  sphere.rotation.z = (data.axialTiltDeg ?? 20 + Math.random() * 15) * DEG;
  tiltGroup.add(sphere);

  // Rings
  if (data.rings) {
    tiltGroup.add(createRings(data, radius));
  }

  // Cloud layer (Earth only)
  let clouds = null;
  if (data.name === 'Earth') {
    clouds = createClouds(radius);
    tiltGroup.add(clouds);
  }

  // Hover glow
  const hoverGlow = createHoverGlow(radius);
  tiltGroup.add(hoverGlow);

  scene.add(tiltGroup);

  const orbitLine = createOrbitPath(distAU, ecc, data.inclinationDeg);

  return { mesh: tiltGroup, sphere, hoverGlow, orbitLine, data, radius, distAU, clouds };
}

// ─────────────────────────────────────────────────────────────────────────────
// Material builders
// ─────────────────────────────────────────────────────────────────────────────

function buildPlanetMaterial(data, radius) {
  if (data.name === 'Earth') return buildEarthMaterial(data);
  const textures = TEX[data.name];
  if (textures?.map) return buildTexturedMaterial(data, textures.map);
  return buildProceduralMaterial(data);
}

// ── Earth — day/night blend + normal map + specular + city lights ─────────
function buildEarthMaterial(data) {
  const mat = new THREE.MeshStandardNodeMaterial();
  const { day, night } = TEX.Earth;

  // Direction from fragment to the Sun (sun is at world origin)
  // normalWorld on a sphere = outward radial direction = correct for terminator
  const sunDirFn = Fn(() => normalize(positionWorld.mul(-1.0)));

  // Color: blend day map + night map across the terminator
  mat.colorNode = Fn(() => {
    const dayCol = texNode(day).rgb;
    const nightCol = texNode(night).rgb;

    const toSun = sunDirFn();
    const nDotL = normalWorld.dot(toSun);
    // dayFactor: 0 on night side, 1 on day side, smooth across terminator
    const dayFactor = nDotL.smoothstep(-0.08, 0.18);

    // Night side: show the map very dimly so landmasses are readable in shadow
    return mix(nightCol.mul(0.06), dayCol, dayFactor);
  })();

  // Emissive: city lights visible on the dark side
  mat.emissiveNode = Fn(() => {
    const cityLights = texNode(night).rgb;
    const toSun = sunDirFn();
    const nDotL = normalWorld.dot(toSun);
    // Night mask: fully 1 when nDotL < -0.15, fades to 0 by nDotL = 0.08
    const nightMask = nDotL.smoothstep(0.08, -0.15);
    return cityLights.mul(nightMask).mul(1.4);
  })();

  mat.roughnessNode = float(0.65);
  mat.metalnessNode = float(0.0);
  return mat;
}

// ── Generic textured planet ───────────────────────────────────────────────
function buildTexturedMaterial(data, map) {
  const mat = new THREE.MeshStandardNodeMaterial();

  if (data.hasBands) {
    // Jupiter / Saturn: overlay procedural bands on top of texture
    const bandCols = data.bandColors.map(c => new THREE.Color(c));

    mat.colorNode = Fn(() => {
      const texCol = texNode(map).rgb;
      const ny = normalWorld.y.mul(0.5).add(0.5);
      const t = time.mul(0.008);
      const b1 = sin(ny.mul(18.0).add(t)).mul(0.5).add(0.5);
      const b2 = sin(ny.mul(28.0).sub(t.mul(1.3))).mul(0.5).add(0.5);

      const c0 = vec3(bandCols[0].r, bandCols[0].g, bandCols[0].b);
      const c1 = vec3(bandCols[1].r, bandCols[1].g, bandCols[1].b);
      const c2 = vec3(bandCols[2].r, bandCols[2].g, bandCols[2].b);

      const bandColor = mix(mix(c0, c1, b1), c2, b2.mul(0.3));
      // Blend 70% texture, 30% procedural band tint
      return mix(texCol, bandColor, float(0.3));
    })();
  } else {
    mat.colorNode = texNode(map);
  }

  const emColor = new THREE.Color(data.emissive);
  mat.emissiveNode = Fn(() => vec3(emColor.r, emColor.g, emColor.b))();

  // Textures planets reflect nicely — lower roughness
  mat.roughnessNode = float(data.roughness * 0.55);
  mat.metalnessNode = float(Math.min(data.metalness + 0.08, 0.25));

  return mat;
}

// ── Fully procedural fallback ─────────────────────────────────────────────
function buildProceduralMaterial(data) {
  const mat = new THREE.MeshStandardNodeMaterial();
  const baseColor = new THREE.Color(data.color);
  const emColor = new THREE.Color(data.emissive);

  mat.colorNode = Fn(() => {
    const p = positionWorld.normalize();
    const t = time.mul(0.02);
    const n = sin(p.x.mul(5.0).add(t)).mul(cos(p.y.mul(4.0))).mul(sin(p.z.mul(6.0))).mul(0.08);
    return vec3(baseColor.r, baseColor.g, baseColor.b).add(n);
  })();

  mat.emissiveNode = Fn(() => vec3(emColor.r, emColor.g, emColor.b))();
  mat.roughnessNode = float(data.roughness * 0.55);
  mat.metalnessNode = float(Math.min(data.metalness + 0.08, 0.25));

  return mat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloud layer (Earth)
// ─────────────────────────────────────────────────────────────────────────────

function createClouds(radius) {
  const cloudTex = TEX.Earth.clouds;
  const geo = new THREE.SphereGeometry(radius * 1.012, 64, 64);
  const mat = new THREE.MeshBasicNodeMaterial();

  // Day/night: bright white on day side, near-black on night side
  mat.colorNode = Fn(() => {
    const toSun = normalize(positionWorld.mul(-1.0));
    const nDotL = normalWorld.dot(toSun);
    const dayFactor = nDotL.smoothstep(-0.08, 0.22);
    return mix(vec3(0.02, 0.02, 0.03), vec3(1.0, 1.0, 1.0), dayFactor);
  })();

  // Opacity from the cloud texture (white = cloud, black = clear)
  mat.opacityNode = texNode(cloudTex).r.mul(float(0.88));
  mat.transparent = true;
  mat.depthWrite = false;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'clouds';
  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rings — Saturn uses real ring alpha texture
// ─────────────────────────────────────────────────────────────────────────────

function createRings(data, planetRadius) {
  const inner = planetRadius * data.ringInnerR;
  const outer = planetRadius * data.ringOuterR;

  const geo = new THREE.RingGeometry(inner, outer, 128, 4);

  // Build radial UV (u = 0 inner … 1 outer)
  const pos = geo.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    const r = Math.sqrt(v3.x * v3.x + v3.z * v3.z);
    const t = (r - inner) / (outer - inner);
    uvs[i * 2] = t;
    uvs[i * 2 + 1] = 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  const ringColor = new THREE.Color(data.ringColor);
  const mat = new THREE.MeshStandardNodeMaterial();

  const ringAlpha = TEX[data.name]?.ringAlpha;

  if (ringAlpha) {
    // Saturn: use real alpha texture for opacity and density-based color
    mat.colorNode = Fn(() => {
      const alpha = texNode(ringAlpha).r;
      const col = vec3(ringColor.r, ringColor.g, ringColor.b);
      return col.mul(alpha.mul(0.5).add(0.6));
    })();

    mat.opacityNode = Fn(() => {
      const alpha = texNode(ringAlpha).r;
      return alpha.mul(float(data.ringOpacity));
    })();
  } else {
    // Uranus: procedural banded look
    mat.colorNode = Fn(() => {
      const t = uv().x;
      const band = sin(t.mul(60.0)).mul(0.5).add(0.5);
      return vec3(ringColor.r, ringColor.g, ringColor.b).mul(band.mul(0.4).add(0.6));
    })();

    mat.opacityNode = Fn(() => {
      const t = uv().x;
      const band = sin(t.mul(60.0)).mul(0.5).add(0.5);
      return band.mul(0.5).add(0.2).mul(float(data.ringOpacity));
    })();
  }

  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  mat.roughnessNode = float(0.9);
  mat.metalnessNode = float(0.0);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.name = `${data.name}_rings`;
  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover glow
// ─────────────────────────────────────────────────────────────────────────────

function createHoverGlow(radius) {
  const geo = new THREE.SphereGeometry(radius * 1.22, 32, 32);
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
  mesh.name = 'hoverGlow';
  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orbit path line
// ─────────────────────────────────────────────────────────────────────────────

export function createOrbitPath(semiMajorAU, eccentricity, inclinationDeg) {
  const a = semiMajorAU;
  const b = a * Math.sqrt(1 - eccentricity ** 2);
  const c = a * eccentricity;

  const points = [];
  const SEG = 256;
  for (let i = 0; i <= SEG; i++) {
    const theta = (i / SEG) * Math.PI * 2;
    const x = a * Math.cos(theta) - c;
    const z = b * Math.sin(theta);
    points.push(new THREE.Vector3(x, 0, z));
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicNodeMaterial();

  mat.colorNode = Fn(() => vec3(0.3, 0.45, 0.7))();
  mat.opacityNode = Fn(() => float(0.25))();
  mat.transparent = true;

  const line = new THREE.Line(geo, mat);
  line.rotation.x = inclinationDeg * DEG;
  line.name = 'orbit_path';
  return line;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orbital position (Kepler)
// ─────────────────────────────────────────────────────────────────────────────

export function getOrbitalPosition(data, elapsedDays) {
  const a = data.distanceAU * DIST_SCALE;
  const ecc = data.eccentricity;
  const b = a * Math.sqrt(1 - ecc * ecc);
  const c = a * ecc;

  const period = data.periodDays;
  const meanAnom = ((elapsedDays % period) / period) * Math.PI * 2;

  let E = meanAnom;
  for (let i = 0; i < 5; i++) E = meanAnom + ecc * Math.sin(E);

  const x = a * Math.cos(E) - c;
  const z = b * Math.sin(E);

  const inc = data.inclinationDeg * DEG;
  return new THREE.Vector3(x, z * Math.sin(inc), z * Math.cos(inc));
}
