/**
 * Solar System — Three.js WebGPU
 * Main entry point
 */

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { PLANET_DATA, SUN_DATA, SUN_RADIUS } from './data/planets.js';
import { createSun } from './Sun.js';
import { createPlanet, getOrbitalPosition, createOrbitPath } from './Planet.js';
import { createMoon } from './Moon.js';
import { createStarfield } from './Starfield.js';
import { createAsteroidBelt, updateAsteroidBelt, updateMeteors } from './AsteroidBelt.js';

// ─────────────────────────────────────────────────────────────────────────────
// Globals
// ─────────────────────────────────────────────────────────────────────────────

let renderer, scene, camera, controls, clock;
let planets = [];
let moons = [];
let orbitLines = [];
let asteroidBelt, meteors;
let sunLight;
let sunObject = null;   // the Sun treated like a selectable body
let starfieldGroup = null; // kept to follow camera every frame

let elapsedDays = 0;
let speedMult = 1;
let showOrbits = false;

// ── Camera navigation ────────────────────────────────────────────────────────
let focusedBody = null;  // body currently being followed
let lastFocusedPos = null;  // planet's world position on the previous frame (for delta tracking)
let camTransition = null;  // { startPos, endPos, startTarget, endTarget, elapsed, duration }

// ── WASD free-fly ────────────────────────────────────────────────────────────
const keysDown = new Set();
// Pre-allocated to avoid per-frame GC pressure
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();

// Raycaster — shared for hover + click
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let planetMeshes = [];        // inner spheres for raycasting (includes Sun core)
let hoveredPlanet = null;   // currently hovered planet/sun/moon object
let pointerDownPos = { x: 0, y: 0 };
let activeSidebarItem = null; // currently highlighted sidebar row

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
    0.1,
    25000
  );
  camera.position.set(0, 300, 700);
  camera.lookAt(0, 0, 0);

  // ── Renderer ───────────────────────────────────────────────────────
  // WebGPURenderer automatically falls back to WebGL2 if WebGPU is unavailable.
  renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
  await renderer.init();

  // Detect which backend was actually used
  const usingWebGPU = renderer.backend?.isWebGPUBackend ?? false;
  if (!usingWebGPU) {
    document.getElementById('fallback').style.display = 'block';
    setTimeout(() => { document.getElementById('fallback').style.display = 'none'; }, 3000);
  }
  console.log(`[Solar System] Backend: ${usingWebGPU ? 'WebGPU' : 'WebGL2 fallback'}`);

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // Update backend badge in sidebar
  document.getElementById('sb-badge').textContent = usingWebGPU ? 'WebGPU' : 'WebGL';

  // ── Controls ───────────────────────────────────────────────────────
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 2;
  controls.maxDistance = 18000;
  controls.zoomSpeed = 1.5;

  // Cancel any in-flight fly-to when the user grabs the camera,
  // but keep focusedBody so the planet-tracking continues through the drag.
  controls.addEventListener('start', () => {
    camTransition = null;
    lastFocusedPos = null; // force delta re-init on next frame
  });

  // ── Scene content ──────────────────────────────────────────────────
  buildScene();
  buildUI();

  // ── Events ─────────────────────────────────────────────────────────
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', (e) => { pointerDownPos = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return; // don't steal slider focus
    keysDown.add(e.code);
  });
  window.addEventListener('keyup', (e) => keysDown.delete(e.code));

  // ── Animation loop ─────────────────────────────────────────────────
  renderer.setAnimationLoop(animate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Build scene
// ─────────────────────────────────────────────────────────────────────────────

function buildScene() {
  // Ambient — very faint fill so planets are never pitch-black on their dark side
  scene.add(new THREE.AmbientLight(0x0d1830, 0.9));

  // Stars — kept in a group so we can move it with the camera each frame
  starfieldGroup = createStarfield(600, 18000);
  scene.add(starfieldGroup);

  // Sun
  const sun = createSun(scene);
  sunLight = sun.sunLight;

  // Configure shadow from sun
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 8000;

  // Create a Sun "object" matching the planet object shape for unified hover/click handling
  sunObject = {
    sphere: sun.core,
    hoverGlow: sun.sunHoverGlow,
    mesh: sun.group,
    data: SUN_DATA,
    isSun: true,
  };
  // Sun core goes first so it's always intersected before planets
  planetMeshes.push(sun.core);

  // Planets
  for (const data of PLANET_DATA) {
    const planet = createPlanet(data, scene);

    // Spread initial orbital angles so planets start at different positions
    const startAngle = Math.random() * Math.PI * 2;
    const startDays = (startAngle / (Math.PI * 2)) * data.periodDays;

    planet.startOffset = startDays;
    planet.rotSpeed = 0.3 + Math.random() * 0.7;
    planets.push(planet);
    // Raycaster targets the inner sphere (tiltGroup itself has no geometry)
    planetMeshes.push(planet.sphere);

    // Orbit path line added to scene (hidden by default)
    planet.orbitLine.visible = false;
    scene.add(planet.orbitLine);
    orbitLines.push(planet.orbitLine);

    // Moons
    if (data.moonData) {
      for (const md of data.moonData) {
        const moon = createMoon(md, planet, scene);
        moons.push(moon);
        planetMeshes.push(moon.sphere);
      }
    }
  }

  // Asteroid belt & meteors
  const beltResult = createAsteroidBelt(scene);
  asteroidBelt = beltResult.belt;
  meteors = beltResult.meteors;

  // Build sidebar
  buildSidebar();

  // Default orbit target is the Sun
  focusedBody = sunObject;
  // Sidebar active state set after buildSidebar() runs (deferred)
  requestAnimationFrame(() => setSidebarActive('Sun'));
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
    const pos = getOrbitalPosition(planet.data, days);
    planet.mesh.position.copy(pos);

    // Self-rotation on the inner sphere (keeps tilt separate)
    planet.sphere.rotation.y += delta * planet.rotSpeed * speedMult;

    // Cloud layer rotates slightly faster than the surface
    if (planet.clouds) planet.clouds.rotation.y += delta * planet.rotSpeed * 1.07 * speedMult;
  }

  // ── Update moon positions ──────────────────────────────────────────
  const DEG = Math.PI / 180;
  for (const moon of moons) {
    moon.orbitAngle += moon.orbitSpeed * delta * speedMult;
    const parent = moon.parentPlanet.mesh.position;
    const inc = (moon.data.inclinationDeg ?? 0) * DEG;
    const x = moon.orbitRadius * Math.cos(moon.orbitAngle);
    const z = moon.orbitRadius * Math.sin(moon.orbitAngle);
    moon.mesh.position.set(
      parent.x + x,
      parent.y + z * Math.sin(inc),
      parent.z + z * Math.cos(inc),
    );
  }

  // ── Update asteroid belt ───────────────────────────────────────────
  updateAsteroidBelt(asteroidBelt, delta, speedMult);

  // ── Update meteors ─────────────────────────────────────────────────
  updateMeteors(meteors, delta, speedMult, scene);

  // ── Camera fly-to transition ───────────────────────────────────────
  if (camTransition) {
    camTransition.elapsed += delta;
    const t = Math.min(camTransition.elapsed / camTransition.duration, 1.0);
    const ease = easeInOutCubic(t);
    camera.position.lerpVectors(camTransition.startPos, camTransition.endPos, ease);
    controls.target.lerpVectors(camTransition.startTarget, camTransition.endTarget, ease);
    if (t >= 1.0) camTransition = null;
  }

  // ── Planet / body tracking ─────────────────────────────────────────
  // Move camera AND target by the exact delta the planet traveled this frame,
  // so the planet appears stationary in the viewport.
  if (focusedBody && !focusedBody.isSun && !camTransition) {
    const currentPos = focusedBody.mesh.position;
    if (lastFocusedPos !== null) {
      const dx = currentPos.x - lastFocusedPos.x;
      const dy = currentPos.y - lastFocusedPos.y;
      const dz = currentPos.z - lastFocusedPos.z;
      controls.target.x += dx;
      controls.target.y += dy;
      controls.target.z += dz;
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
    }
    lastFocusedPos = currentPos.clone();
  }

  // ── WASD free-fly ──────────────────────────────────────────────────
  if (keysDown.size > 0) {
    const sprint = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');
    // Speed scales with distance to target so it feels the same at any zoom level
    const speed = controls.target.distanceTo(camera.position) * delta * (sprint ? 0.6 : 0.12);

    camera.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, camera.up).normalize();
    _move.set(0, 0, 0);

    if (keysDown.has('KeyW')) _move.addScaledVector(_fwd, speed);
    if (keysDown.has('KeyS')) _move.addScaledVector(_fwd, -speed);
    if (keysDown.has('KeyA')) _move.addScaledVector(_right, -speed);
    if (keysDown.has('KeyD')) _move.addScaledVector(_right, speed);

    if (_move.lengthSq() > 0) {
      camera.position.add(_move);
      controls.target.add(_move);
      // Break planet-follow so tracking doesn't fight the manual movement
      focusedBody = null;
      lastFocusedPos = null;
    }
  }

  // ── Starfield follows camera so the skybox always surrounds the viewer ──
  if (starfieldGroup) starfieldGroup.position.copy(camera.position);

  // ── Orbit controls ────────────────────────────────────────────────
  controls.update();

  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────

function buildUI() {
  // Speed slider
  const slider = document.getElementById('speed-slider');
  const speedVal = document.getElementById('speed-val');

  // Map slider 0..5 → time multiplier: 0 = paused, 1 = 1×, 5 = ~5000×
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    // Exponential scale: 0→0, 1→1, 5→10000
    speedMult = v === 0 ? 0 : Math.pow(10, v * 0.85 - 0.85);
    speedVal.textContent = v === 0 ? 'PAUSE' : `${speedMult.toFixed(speedMult < 10 ? 1 : 0)}×`;
  });

  // Orbits toggle
  const orbitsSlider = document.getElementById('orbits-toggle');
  const orbitsVal = document.getElementById('orbits-val');

  orbitsSlider.addEventListener('input', () => {
    showOrbits = orbitsSlider.value === '1';
    orbitsVal.textContent = showOrbits ? 'ON' : 'OFF';
    for (const line of orbitLines) line.visible = showOrbits;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────

function buildSidebar() {
  const list = document.getElementById('sb-list');
  list.innerHTML = '';

  // Sun row
  list.appendChild(makePlanetRow(SUN_DATA, sunObject, '#ffb020'));

  for (const data of PLANET_DATA) {
    const planet = planets.find(p => p.data === data);
    const moonList = moons.filter(m => m.data.parentName === data.name);
    const hasMoons = moonList.length > 0;
    const hex = '#' + data.color.toString(16).padStart(6, '0');

    const wrapper = document.createElement('div');
    wrapper.className = 'sb-planet-wrapper';

    const planetRow = makePlanetRow(data, planet, hex, hasMoons);
    wrapper.appendChild(planetRow);

    if (hasMoons) {
      const moonListEl = document.createElement('div');
      moonListEl.className = 'sb-moon-list';

      for (const moon of moonList) {
        const moonRow = document.createElement('div');
        moonRow.className = 'sb-moon-row';
        moonRow.dataset.name = moon.data.name.toLowerCase();
        moonRow.dataset.bodyName = moon.data.name;
        moonRow.innerHTML = `<div class="sb-moon-dot"></div>
                             <span class="sb-moon-name">${moon.data.name}</span>`;
        moonRow.addEventListener('click', () => {
          setSidebarActive(moon.data.name);
          flyToBody(moon);
          showPlanetInfo(moon.data);
          closeSidebarMobile();
        });
        moonListEl.appendChild(moonRow);
      }

      const expandBtn = planetRow.querySelector('.sb-expand-btn');
      if (expandBtn) {
        expandBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = moonListEl.classList.toggle('open');
          expandBtn.classList.toggle('open', open);
        });
      }

      wrapper.appendChild(moonListEl);
    }

    list.appendChild(wrapper);
  }

  // Search
  document.getElementById('sb-search').addEventListener('input', (e) => {
    filterSidebar(e.target.value.toLowerCase().trim());
  });
}

function makePlanetRow(data, bodyObj, hex, hasMoons = false) {
  const row = document.createElement('div');
  row.className = 'sb-planet-row';
  row.dataset.name = data.name.toLowerCase();
  row.dataset.bodyName = data.name;
  row.innerHTML = `
    <div class="sb-dot" style="background:${hex}"></div>
    <span class="sb-planet-name">${data.name}</span>
    ${hasMoons ? '<button class="sb-expand-btn" title="Toggle moons">›</button>' : ''}
  `;
  row.addEventListener('click', (e) => {
    if (e.target.classList.contains('sb-expand-btn')) return;
    setSidebarActive(data.name);
    if (bodyObj) {
      flyToBody(bodyObj);
      showPlanetInfo(data);
      closeSidebarMobile();
    }
  });
  return row;
}

function closeSidebarMobile() {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sb-overlay').classList.remove('visible');
  }
}

function setSidebarActive(bodyName) {
  if (activeSidebarItem) activeSidebarItem.classList.remove('active');
  const el = document.querySelector(
    `[data-body-name="${CSS.escape(bodyName)}"]`
  );
  activeSidebarItem = el ?? null;
  if (activeSidebarItem) activeSidebarItem.classList.add('active');
}

function filterSidebar(q) {
  // Sun row (direct child of list, not in wrapper)
  const sunRow = document.querySelector('#sb-list > .sb-planet-row');
  if (sunRow) sunRow.classList.toggle('sb-hidden', !!q && !'sun'.includes(q));

  document.querySelectorAll('.sb-planet-wrapper').forEach(wrapper => {
    const planetRow = wrapper.querySelector('.sb-planet-row');
    const moonRows = wrapper.querySelectorAll('.sb-moon-row');
    const moonListEl = wrapper.querySelector('.sb-moon-list');
    const expandBtn = wrapper.querySelector('.sb-expand-btn');

    const planetMatch = !q || (planetRow?.dataset.name ?? '').includes(q);
    let anyMoonMatch = false;

    moonRows.forEach(mr => {
      const match = !q || mr.dataset.name.includes(q);
      mr.classList.toggle('sb-hidden', !match);
      if (match) anyMoonMatch = true;
    });

    const show = planetMatch || anyMoonMatch;
    wrapper.style.display = show ? '' : 'none';

    // Auto-expand moons when a moon search matches
    if (moonListEl && anyMoonMatch && q) {
      moonListEl.classList.add('open');
      expandBtn?.classList.add('open');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera fly-to — smoothly navigate to a planet or the Sun
// ─────────────────────────────────────────────────────────────────────────────

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function flyToBody(body) {
  if (!body) return;

  // Where should the orbit pivot be?
  const endTarget = body.isSun
    ? new THREE.Vector3(0, 0, 0)
    : body.mesh.position.clone();

  // How far from the pivot should the camera sit?
  const approachDist = body.isSun
    ? SUN_RADIUS * 2.5                        // see the full solar disk
    : body.isMoon
      ? Math.max(body.radius * 10, 2.0)       // moons need more breathing room
      : Math.max(body.radius * 5, 1.5);       // proportional; min 1.5 for tiny planets

  // Keep current viewing angle but aim at the new target
  const currentDir = camera.position.clone().sub(controls.target).normalize();
  const endPos = endTarget.clone().add(currentDir.multiplyScalar(approachDist));

  camTransition = {
    startPos: camera.position.clone(),
    endPos,
    startTarget: controls.target.clone(),
    endTarget: endTarget.clone(),
    elapsed: 0,
    duration: 2.0,                         // seconds
  };

  focusedBody = body;
  lastFocusedPos = null; // delta tracking initialises on the first frame after transition
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover detection
// ─────────────────────────────────────────────────────────────────────────────

function findObjectBySphere(obj) {
  if (sunObject && sunObject.sphere === obj) return sunObject;
  const planet = planets.find(p => p.sphere === obj);
  if (planet) return planet;
  return moons.find(m => m.sphere === obj) ?? null;
}

function onPointerMove(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(planetMeshes, false);

  if (hits.length > 0) {
    const obj = hits[0].object;
    const body = findObjectBySphere(obj);
    if (body && body !== hoveredPlanet) {
      // Leave previous
      if (hoveredPlanet) {
        hoveredPlanet.hoverGlow.visible = false;
        if (!hoveredPlanet.isSun) hoveredPlanet.mesh.scale.setScalar(1.0);
      }
      // Enter new
      hoveredPlanet = body;
      hoveredPlanet.hoverGlow.visible = true;
      if (!hoveredPlanet.isSun) hoveredPlanet.mesh.scale.setScalar(1.06);
      document.body.style.cursor = 'pointer';
    }
  } else {
    if (hoveredPlanet) {
      hoveredPlanet.hoverGlow.visible = false;
      if (!hoveredPlanet.isSun) hoveredPlanet.mesh.scale.setScalar(1.0);
      hoveredPlanet = null;
    }
    document.body.style.cursor = 'default';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Click — show info panel for hovered planet
// ─────────────────────────────────────────────────────────────────────────────

function onPointerUp(event) {
  if (event.target !== renderer.domElement) return; // ignore UI clicks
  const dx = event.clientX - pointerDownPos.x;
  const dy = event.clientY - pointerDownPos.y;
  if (dx * dx + dy * dy > 25) return; // was a drag — do nothing

  if (hoveredPlanet) {
    flyToBody(hoveredPlanet);
    showPlanetInfo(hoveredPlanet.data);
    setSidebarActive(hoveredPlanet.data.name);
  } else {
    // Click on empty space — return to orbiting the Sun
    flyToBody(sunObject);
    document.getElementById('planet-info').classList.remove('visible');
    setSidebarActive('Sun');
  }
}

function showPlanetInfo(data) {
  if (data.parentName) { showMoonInfo(data); return; }
  const panel = document.getElementById('planet-info');
  const isStar = data.name === 'Sun';

  // ── Header ────────────────────────────────────────────────────────
  const hex = '#' + data.color.toString(16).padStart(6, '0');
  document.getElementById('pi-color-bar').style.background =
    `linear-gradient(135deg, ${hex}88, ${hex}22)`;
  document.getElementById('pi-type').textContent = data.type ?? '';
  document.getElementById('pi-name').textContent = data.name;
  document.getElementById('pi-subtitle').textContent = data.subtitle ?? '';

  // ── Orbital ───────────────────────────────────────────────────────
  document.getElementById('pi-diam').textContent = `${(data.radiusKm * 2).toLocaleString()} km`;
  document.getElementById('pi-dist-label').textContent = isStar ? 'Location' : 'Distance from Sun';

  if (isStar) {
    document.getElementById('pi-dist').textContent = 'Center of Solar System';
    document.getElementById('pi-period').textContent = '—';
  } else {
    document.getElementById('pi-dist').textContent = `${data.distanceAU.toFixed(3)} AU`;
    const period = data.periodDays >= 365
      ? `${(data.periodDays / 365.25).toFixed(2)} yr`
      : `${data.periodDays.toFixed(1)} d`;
    document.getElementById('pi-period').textContent = period;
  }
  document.getElementById('pi-moons').textContent = data.moons.toLocaleString();

  // ── Physical ──────────────────────────────────────────────────────
  document.getElementById('pi-gravity').textContent = `${data.gravityG?.toFixed(2) ?? '?'} g`;
  document.getElementById('pi-density').textContent = `${data.density?.toFixed(2) ?? '?'} g/cm³`;
  document.getElementById('pi-escape').textContent = `${data.escapeVelKms?.toFixed(1) ?? '?'} km/s`;
  const rotStr = data.rotationDays != null
    ? (Math.abs(data.rotationDays) < 1
      ? `${(Math.abs(data.rotationDays) * 24).toFixed(1)} h${data.rotationDays < 0 ? ' ↺' : ''}`
      : `${Math.abs(data.rotationDays).toFixed(2)} d${data.rotationDays < 0 ? ' ↺' : ''}`)
    : '?';
  document.getElementById('pi-rotation').textContent = rotStr;
  document.getElementById('pi-tilt').textContent = `${data.axialTiltDeg?.toFixed(1) ?? '?'}°`;

  // ── Temperature bar ───────────────────────────────────────────────
  const tMin = data.tempMin ?? -200, tMax = data.tempMax ?? 200, tAvg = data.tempAvg ?? 0;

  if (isStar) {
    // For the Sun the photosphere range (4400–6000°C) blows the regular scale;
    // pin the marker at 100% (hot extreme) and show meaningful labels.
    document.getElementById('pi-temp-min').textContent = `${tMin.toLocaleString()} °C`;
    document.getElementById('pi-temp-max').textContent = `${tMax.toLocaleString()} °C`;
    document.getElementById('pi-temp-avg').textContent = `photosphere avg ${tAvg.toLocaleString()} °C  ·  core ~15,000,000 °C`;
    document.getElementById('pi-temp-marker').style.left = '100%';
  } else {
    document.getElementById('pi-temp-min').textContent = `${tMin} °C`;
    document.getElementById('pi-temp-max').textContent = `${tMax} °C`;
    document.getElementById('pi-temp-avg').textContent = `avg ${tAvg} °C`;
    const range = 750, offset = 250;
    const pct = Math.max(0, Math.min(100, ((tAvg + offset) / range) * 100));
    document.getElementById('pi-temp-marker').style.left = `${pct}%`;
  }

  // ── Atmosphere ────────────────────────────────────────────────────
  document.getElementById('pi-atmo').textContent = data.atmosphere ?? '—';
  document.getElementById('pi-atmo-detail').textContent = data.atmoDetail ?? '';
  document.getElementById('pi-magnetic').textContent = data.magneticField ?? '—';

  // ── Fun facts ─────────────────────────────────────────────────────
  const factsList = document.getElementById('pi-facts');
  factsList.innerHTML = '';
  (data.facts ?? []).forEach(f => {
    const li = document.createElement('li');
    li.textContent = f;
    factsList.appendChild(li);
  });

  panel.classList.add('visible');
  if (window.innerWidth <= 768) {
    panel.classList.add('minimised');
  }
}

function showMoonInfo(data) {
  const panel = document.getElementById('planet-info');
  const hex = '#' + data.color.toString(16).padStart(6, '0');

  document.getElementById('pi-color-bar').style.background =
    `linear-gradient(135deg, ${hex}88, ${hex}22)`;
  document.getElementById('pi-type').textContent = data.type ?? 'Natural Satellite';
  document.getElementById('pi-name').textContent = data.name;
  document.getElementById('pi-subtitle').textContent = data.subtitle ?? `Moon of ${data.parentName}`;

  document.getElementById('pi-diam').textContent = `${(data.radiusKm * 2).toLocaleString()} km`;
  document.getElementById('pi-dist-label').textContent = `Distance from ${data.parentName}`;
  document.getElementById('pi-dist').textContent = `${data.distancePlanetKm.toLocaleString()} km`;

  const absPeriod = Math.abs(data.periodDays);
  const retrograde = data.periodDays < 0 ? ' ↺' : '';
  const period = absPeriod < 1
    ? `${(absPeriod * 24).toFixed(1)} h${retrograde}`
    : `${absPeriod.toFixed(2)} d${retrograde}`;
  document.getElementById('pi-period').textContent = period;
  document.getElementById('pi-moons').textContent = '—';

  document.getElementById('pi-gravity').textContent = data.gravityG ? `${data.gravityG.toFixed(2)} g` : '—';
  document.getElementById('pi-density').textContent = data.density ? `${data.density.toFixed(2)} g/cm³` : '—';
  document.getElementById('pi-escape').textContent = data.escapeVelKms ? `${data.escapeVelKms.toFixed(2)} km/s` : '—';
  document.getElementById('pi-rotation').textContent = 'Tidally locked';
  document.getElementById('pi-tilt').textContent = data.axialTiltDeg != null ? `${data.axialTiltDeg.toFixed(1)}°` : '—';

  const tMin = data.tempMin ?? null, tMax = data.tempMax ?? null, tAvg = data.tempAvg ?? null;
  document.getElementById('pi-temp-min').textContent = tMin != null ? `${tMin} °C` : '—';
  document.getElementById('pi-temp-max').textContent = tMax != null ? `${tMax} °C` : '';
  document.getElementById('pi-temp-avg').textContent = tAvg != null ? `avg ${tAvg} °C` : '';
  if (tAvg != null) {
    const range = 750, offset = 250;
    const pct = Math.max(0, Math.min(100, ((tAvg + offset) / range) * 100));
    document.getElementById('pi-temp-marker').style.left = `${pct}%`;
  } else {
    document.getElementById('pi-temp-marker').style.left = '50%';
  }

  document.getElementById('pi-atmo').textContent = data.atmosphere ?? 'None';
  document.getElementById('pi-atmo-detail').textContent = data.atmoDetail ?? '';
  document.getElementById('pi-magnetic').textContent = data.magneticField ?? '—';

  const factsList = document.getElementById('pi-facts');
  factsList.innerHTML = '';
  (data.facts ?? []).forEach(f => {
    const li = document.createElement('li');
    li.textContent = f;
    factsList.appendChild(li);
  });

  panel.classList.add('visible');
  if (window.innerWidth <= 768) {
    panel.classList.add('minimised');
  }
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
