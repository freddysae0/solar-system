import * as THREE from 'three/webgpu';
import { Fn, float, vec3, attribute, instanceIndex } from 'three/tsl';

/**
 * Creates a large starfield using Points.
 * Stars have slight color variation (blue-white, yellow-white, orange).
 */
export function createStarfield(count = 8000, radius = 900) {
  const geometry = new THREE.BufferGeometry();

  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  const sizes     = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Uniform distribution on a sphere shell
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = radius * (0.7 + 0.3 * Math.random());

    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Star color types
    const type = Math.random();
    let cr, cg, cb;
    if (type < 0.05) {
      // Blue-hot
      cr = 0.7; cg = 0.8; cb = 1.0;
    } else if (type < 0.20) {
      // Yellow-white (like our Sun)
      cr = 1.0; cg = 0.95; cb = 0.75;
    } else if (type < 0.30) {
      // Orange
      cr = 1.0; cg = 0.7; cb = 0.4;
    } else {
      // Cool white
      const v = 0.55 + 0.45 * Math.random();
      cr = v; cg = v; cb = v + 0.05;
    }
    colors[i * 3]     = cr;
    colors[i * 3 + 1] = cg;
    colors[i * 3 + 2] = cb;

    // Size variation
    sizes[i] = 0.5 + Math.random() * 2.5;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsNodeMaterial({ vertexColors: true });

  // Use vertex colors directly
  material.colorNode = Fn(() => {
    const col = attribute('color', 'vec3');
    return col;
  })();

  material.sizeNode = attribute('aSize', 'float');

  const stars = new THREE.Points(geometry, material);
  stars.name = 'Starfield';
  // Stars don't need to be depth-tested against other stars
  stars.renderOrder = -1;

  return stars;
}
