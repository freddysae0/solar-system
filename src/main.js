/**
 * Solar System — Three.js WebGPU
 * Main entry point
 */

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { PLANET_DATA } from './data/planets.js';
import { createSun } from './Sun.js';
import { createPlanet, getOrbitalPosition, createOrbitPath } from './Planet.js';
import { createStarfield } from './Starfield.js';
import { createAsteroidBelt, updateAsteroidBelt, updateMeteors } from './AsteroidBelt.js';

// ─────────────────────────────────────────────────────────────────────────────
// Globals
// ─────────────────────────────────────────────────────────────────────────────

let renderer, scene, camera, controls, clock;
let planets = [];
let orbitLines = [];
let asteroidBelt, meteors;
let sunLight;

let elapsedDays = 0;
let speedMult   = 1;
let showOrbits  = true;

// Raycaster — shared for hover + click
const raycaster     = new THREE.Raycaster();
const mouse         = new THREE.Vector2();
let   planetMeshes  = [];        // inner spheres for raycasting
let   hoveredPlanet = null;      // currently hovered planet object
let   pointerDownPos = { x: 0, y: 0 };

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  clock = new THREE.Clock();

  // ── Scene ──────────────────────────────────────────────────────────
  scene = new THREE.Scene();

  // ── Camera ─────────────────────────────────────────────────────────
  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.05,
    5000
  );
  camera.position.set(0, 45, 110);
  camera.lookAt(0, 0, 0);

  // ── Renderer ───────────────────────────────────────────────────────
  // WebGPURenderer automatically falls back to WebGL2 if WebGPU is unavailable.
  renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
  await renderer.init();

  // Detect which backend was actually used
  const usingWebGPU = renderer.backend?.constructor?.name?.includes('WebGPU') ?? false;
  if (!usingWebGPU) {
    document.getElementById('fallback').style.display = 'block';
    setTimeout(() => { document.getElementById('fallback').style.display = 'none'; }, 3000);
  }
  console.log(`[Solar System] Backend: ${usingWebGPU ? 'WebGPU' : 'WebGL2 fallback'}`);

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // Update title badge
  document.getElementById('title').textContent =
    `Solar System · ${usingWebGPU ? 'WebGPU' : 'WebGL'}`;

  // ── Controls ───────────────────────────────────────────────────────
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping    = true;
  controls.dampingFactor    = 0.05;
  controls.minDistance      = 2;
  controls.maxDistance      = 1200;
  controls.zoomSpeed        = 1.5;

  // ── Scene content ──────────────────────────────────────────────────
  buildScene();
  buildUI();

  // ── Events ─────────────────────────────────────────────────────────
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', (e) => { pointerDownPos = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointerup',   onPointerUp);

  // ── Animation loop ─────────────────────────────────────────────────
  renderer.setAnimationLoop(animate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Build scene
// ─────────────────────────────────────────────────────────────────────────────

function buildScene() {
  // Stars
  scene.add(createStarfield(10000, 1800));

  // Sun
  const sun = createSun(scene);
  sunLight   = sun.sunLight;

  // Configure shadow from sun
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far  = 1000;

  // Planets
  for (const data of PLANET_DATA) {
    const planet = createPlanet(data, scene);

    // Spread initial orbital angles so planets start at different positions
    const startAngle = Math.random() * Math.PI * 2;
    const startDays  = (startAngle / (Math.PI * 2)) * data.periodDays;

    planet.startOffset = startDays;
    planet.rotSpeed    = 0.3 + Math.random() * 0.7;
    planets.push(planet);
    // Raycaster targets the inner sphere (tiltGroup itself has no geometry)
    planetMeshes.push(planet.sphere);

    // Orbit path line added to scene
    scene.add(planet.orbitLine);
    orbitLines.push(planet.orbitLine);
  }

  // Asteroid belt & meteors
  const beltResult = createAsteroidBelt(scene);
  asteroidBelt = beltResult.belt;
  meteors      = beltResult.meteors;

  // Build legend
  buildLegend();
}

// ─────────────────────────────────────────────────────────────────────────────
// Animate
// ─────────────────────────────────────────────────────────────────────────────

function animate() {
  const delta = clock.getDelta();
  elapsedDays += delta * speedMult;

  // ── Update planet positions ────────────────────────────────────────
  for (const planet of planets) {
    const days = elapsedDays + planet.startOffset;
    const pos  = getOrbitalPosition(planet.data, days);
    planet.mesh.position.copy(pos);

    // Self-rotation on the inner sphere (keeps tilt separate)
    planet.sphere.rotation.y += delta * planet.rotSpeed * speedMult;
  }

  // ── Update asteroid belt ───────────────────────────────────────────
  updateAsteroidBelt(asteroidBelt, delta, speedMult);

  // ── Update meteors ─────────────────────────────────────────────────
  updateMeteors(meteors, delta, speedMult, scene);

  // ── Orbit controls ────────────────────────────────────────────────
  controls.update();

  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────

function buildUI() {
  // Speed slider
  const slider   = document.getElementById('speed-slider');
  const speedVal = document.getElementById('speed-val');

  // Map slider 0..5 → time multiplier: 0 = paused, 1 = 1×, 5 = ~5000×
  slider.addEventListener('input', () => {
    const v    = parseFloat(slider.value);
    // Exponential scale: 0→0, 1→1, 5→10000
    speedMult  = v === 0 ? 0 : Math.pow(10, v * 0.85 - 0.85);
    speedVal.textContent = v === 0 ? 'PAUSE' : `${speedMult.toFixed(speedMult < 10 ? 1 : 0)}×`;
  });

  // Orbits toggle
  const orbitsSlider = document.getElementById('orbits-toggle');
  const orbitsVal    = document.getElementById('orbits-val');

  orbitsSlider.addEventListener('input', () => {
    showOrbits = orbitsSlider.value === '1';
    orbitsVal.textContent = showOrbits ? 'ON' : 'OFF';
    for (const line of orbitLines) line.visible = showOrbits;
  });
}

function buildLegend() {
  const legendEl = document.getElementById('legend');
  legendEl.innerHTML = '';

  // Sun entry
  const sunEntry = document.createElement('div');
  sunEntry.className = 'legend-item';
  sunEntry.innerHTML = `<div class="dot" style="background:#ffb020"></div><span>Sun</span>`;
  legendEl.appendChild(sunEntry);

  for (const data of PLANET_DATA) {
    const entry  = document.createElement('div');
    entry.className = 'legend-item';
    const hex    = '#' + data.color.toString(16).padStart(6, '0');
    entry.innerHTML = `<div class="dot" style="background:${hex}"></div><span>${data.name}</span>`;
    legendEl.appendChild(entry);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover detection
// ─────────────────────────────────────────────────────────────────────────────

function onPointerMove(event) {
  mouse.x = (event.clientX / window.innerWidth)  * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(planetMeshes, false);

  if (hits.length > 0) {
    const obj    = hits[0].object;
    const planet = planets.find(p => p.sphere === obj);
    if (planet && planet !== hoveredPlanet) {
      // Leave previous
      if (hoveredPlanet) {
        hoveredPlanet.hoverGlow.visible = false;
        hoveredPlanet.mesh.scale.setScalar(1.0);
      }
      // Enter new
      hoveredPlanet = planet;
      hoveredPlanet.hoverGlow.visible = true;
      hoveredPlanet.mesh.scale.setScalar(1.06);
      document.body.style.cursor = 'pointer';
    }
  } else {
    if (hoveredPlanet) {
      hoveredPlanet.hoverGlow.visible = false;
      hoveredPlanet.mesh.scale.setScalar(1.0);
      hoveredPlanet = null;
    }
    document.body.style.cursor = 'default';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Click — show info panel for hovered planet
// ─────────────────────────────────────────────────────────────────────────────

function onPointerUp(event) {
  const dx = event.clientX - pointerDownPos.x;
  const dy = event.clientY - pointerDownPos.y;
  if (dx * dx + dy * dy > 25) return; // was a drag

  if (hoveredPlanet) {
    showPlanetInfo(hoveredPlanet.data);
  } else {
    // Click on empty space — close panel
    const panel = document.getElementById('planet-info');
    panel.classList.remove('visible');
  }
}

function showPlanetInfo(data) {
  const panel = document.getElementById('planet-info');

  // ── Header ────────────────────────────────────────────────────────
  const hex = '#' + data.color.toString(16).padStart(6, '0');
  document.getElementById('pi-color-bar').style.background =
    `linear-gradient(135deg, ${hex}88, ${hex}22)`;
  document.getElementById('pi-type').textContent    = data.type ?? '';
  document.getElementById('pi-name').textContent    = data.name;
  document.getElementById('pi-subtitle').textContent = data.subtitle ?? '';

  // ── Orbital ───────────────────────────────────────────────────────
  document.getElementById('pi-diam').textContent   = `${(data.radiusKm * 2).toLocaleString()} km`;
  document.getElementById('pi-dist').textContent   = `${data.distanceAU.toFixed(3)} AU`;
  const period = data.periodDays >= 365
    ? `${(data.periodDays / 365.25).toFixed(2)} yr`
    : `${data.periodDays.toFixed(1)} d`;
  document.getElementById('pi-period').textContent  = period;
  document.getElementById('pi-moons').textContent   = data.moons.toLocaleString();

  // ── Physical ──────────────────────────────────────────────────────
  document.getElementById('pi-gravity').textContent  = `${data.gravityG?.toFixed(2) ?? '?'} g`;
  document.getElementById('pi-density').textContent  = `${data.density?.toFixed(2) ?? '?'} g/cm³`;
  document.getElementById('pi-escape').textContent   = `${data.escapeVelKms?.toFixed(1) ?? '?'} km/s`;
  const rotStr = data.rotationDays != null
    ? (Math.abs(data.rotationDays) < 1
        ? `${(Math.abs(data.rotationDays) * 24).toFixed(1)} h${data.rotationDays < 0 ? ' ↺' : ''}`
        : `${Math.abs(data.rotationDays).toFixed(2)} d${data.rotationDays < 0 ? ' ↺' : ''}`)
    : '?';
  document.getElementById('pi-rotation').textContent = rotStr;
  document.getElementById('pi-tilt').textContent     = `${data.axialTiltDeg?.toFixed(1) ?? '?'}°`;

  // ── Temperature bar ───────────────────────────────────────────────
  const tMin = data.tempMin ?? -200, tMax = data.tempMax ?? 200, tAvg = data.tempAvg ?? 0;
  document.getElementById('pi-temp-min').textContent = `${tMin} °C`;
  document.getElementById('pi-temp-max').textContent = `${tMax} °C`;
  document.getElementById('pi-temp-avg').textContent = `avg ${tAvg} °C`;
  // Position avg marker on bar (range clamped -250 to 500)
  const range = 750, offset = 250;
  const pct = Math.max(0, Math.min(100, ((tAvg + offset) / range) * 100));
  document.getElementById('pi-temp-marker').style.left = `${pct}%`;

  // ── Atmosphere ────────────────────────────────────────────────────
  document.getElementById('pi-atmo').textContent      = data.atmosphere ?? '—';
  document.getElementById('pi-atmo-detail').textContent = data.atmoDetail ?? '';
  document.getElementById('pi-magnetic').textContent  = data.magneticField ?? '—';

  // ── Fun facts ─────────────────────────────────────────────────────
  const factsList = document.getElementById('pi-facts');
  factsList.innerHTML = '';
  (data.facts ?? []).forEach(f => {
    const li = document.createElement('li');
    li.textContent = f;
    factsList.appendChild(li);
  });

  panel.classList.add('visible');
}

// ─────────────────────────────────────────────────────────────────────────────
// Resize
// ─────────────────────────────────────────────────────────────────────────────

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

init().catch(console.error);
