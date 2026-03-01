import * as THREE from 'three/webgpu';
import { Fn, float, vec3, attribute, sin, time } from 'three/tsl';

/**
 * Starfield:
 *  - Background sphere with 2k Milky Way texture (MeshBasicMaterial, BackSide)
 *  - Overlay of bright procedural stars with twinkling (Points + TSL)
 */
export function createStarfield(count = 600, radius = 1800) {
  const group = new THREE.Group();
  group.name = 'Starfield';

  // ── Milky Way background sphere ───────────────────────────────────
  const bgGeo = new THREE.SphereGeometry(radius, 64, 32);
  const bgTex = new THREE.TextureLoader().load('/src/assets/8k_stars_milky_way.jpg');
  bgTex.colorSpace = THREE.SRGBColorSpace;

  const bgMat = new THREE.MeshBasicMaterial({
    map:  bgTex,
    side: THREE.BackSide,
  });

  const bgSphere = new THREE.Mesh(bgGeo, bgMat);
  bgSphere.renderOrder = -2;
  group.add(bgSphere);

  // ── Bright star overlay for twinkling ─────────────────────────────
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  const sizes     = new Float32Array(count);
  const phases    = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = radius * 0.97;

    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Stellar spectral types — only bright visible stars
    const t = Math.random();
    let cr, cg, cb;
    if      (t < 0.12) { cr = 0.65; cg = 0.78; cb = 1.00; }  // B — blue-white
    else if (t < 0.38) { cr = 0.92; cg = 0.95; cb = 1.00; }  // A — white
    else if (t < 0.68) { cr = 1.00; cg = 0.96; cb = 0.80; }  // F/G — yellow-white
    else               { cr = 1.00; cg = 0.78; cb = 0.50; }  // K — orange

    colors[i * 3]     = cr;
    colors[i * 3 + 1] = cg;
    colors[i * 3 + 2] = cb;

    sizes[i]  = 2.0 + Math.random() * 5.0;
    phases[i] = Math.random() * Math.PI * 2;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  geometry.setAttribute('aSize',    new THREE.BufferAttribute(sizes,     1));
  geometry.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));

  const material = new THREE.PointsNodeMaterial({ vertexColors: true });

  material.colorNode = Fn(() => {
    const col    = attribute('color',  'vec3');
    const phase  = attribute('aPhase', 'float');
    const twinkle = sin(time.mul(2.5).add(phase)).mul(0.18).add(0.82);
    return col.mul(twinkle);
  })();

  material.sizeNode = attribute('aSize', 'float');

  const stars = new THREE.Points(geometry, material);
  stars.renderOrder = -1;
  group.add(stars);

  return group;
}
