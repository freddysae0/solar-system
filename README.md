# Solar System — WebGPU

An interactive, real-time 3D visualization of the solar system built with **Three.js WebGPU** and **TSL (Three.js Shading Language)**. Explore all 8 planets, 23 notable moons, the asteroid belt, and a procedural starfield — with scientifically accurate orbital mechanics, high-quality NASA textures, and a fully responsive UI.

---

## Features

### Celestial Bodies
- **8 Planets** — Mercury through Neptune with accurate orbital parameters (semi-major axis, eccentricity, inclination, axial tilt, rotation period)
- **23 Notable Moons** — Full orbital and physical data for major moons across all outer planets:
  - Earth: Moon
  - Mars: Phobos, Deimos
  - Jupiter: Io, Europa, Ganymede, Callisto, Amalthea
  - Saturn: Titan, Rhea, Dione, Tethys, Enceladus, Mimas, Iapetus, Hyperion
  - Uranus: Miranda, Ariel, Umbriel, Titania, Oberon
  - Neptune: Triton (retrograde), Nereid
- **Sun** — animated plasma surface with dynamic glow and point lighting
- **Asteroid Belt** — 3,000 instanced asteroids between Mars and Jupiter
- **Meteors** — 12 animated line streaks traversing the system

### Rendering & Shaders (TSL / WebGPU)
- WebGPU renderer with automatic WebGL2 fallback
- All materials written in **TSL** — no raw GLSL needed
- **Earth**: terminator day/night map blending, city lights on the dark side, animated cloud layer (rotates 1.07× faster than the surface)
- **Sun**: 65% texture / 35% procedural plasma, animated in both `colorNode` and `emissiveNode`
- **Jupiter / Saturn**: procedural animated atmospheric bands overlaid on textures
- **Saturn rings**: alpha-blended ring texture sampled with radial UVs (1.25R → 2.3R)
- **Hover glow**: Fresnel-style rim glow on all bodies
- **Starfield**: 8K Milky Way background sphere + 600 procedural overlay stars with TSL twinkling, stellar color types (O/B/A/F/G/K), and diffraction spikes

### Orbital Mechanics
- Elliptical orbits with eccentricity and inclination per body
- Per-frame axial rotation at realistic relative rates
- Retrograde moons (Triton) naturally handled via negative orbital period
- Smooth camera fly-to with `easeInOutCubic` interpolation
- **Planet tracking**: selected body stays centred as camera follows its motion

### UI
- **Left sidebar** — searchable list of all bodies with expandable moon sub-menus; collapses to a thin strip on desktop, hamburger-toggled on mobile
- **Info panel** — slides in on body selection showing:
  - Orbital data (diameter, distance, period, moon count)
  - Physical properties (gravity, density, escape velocity, day length, axial tilt)
  - Surface temperature gradient bar (min / avg / max)
  - Atmosphere composition and magnetic field
  - 3–5 curated scientific facts
- **Time speed slider** — pause (0) to ~10,000× real-time (exponential scale)
- **Orbit lines toggle** — show / hide all orbital paths
- **WASD free-fly** — move camera independently of the tracked body
- **WebGPU / WebGL badge** — shows which renderer is active
- Fully **responsive** — desktop sidebar, mobile bottom-sheet info panel, touch-friendly 44px tap targets

---

## Tech Stack

| Layer | Technology |
|---|---|
| Renderer | Three.js WebGPURenderer (WebGL2 fallback) |
| Shading | TSL — Three.js Shading Language (`three/tsl`) |
| Build | Vite 6 |
| Core library | Three.js ^0.172.0 |
| Language | ES2022 modules |

---

## Project Structure

```
solar-system/
├── index.html              # HUD, sidebar, info panel, controls
├── package.json
└── src/
    ├── main.js             # Scene init, animation loop, raycaster, UI logic
    ├── Sun.js              # Sun mesh, PointLight, TSL plasma animation
    ├── Planet.js           # Planet meshes, rings, clouds, orbit lines
    ├── Moon.js             # Moon objects with per-body orbital data
    ├── Starfield.js        # Milky Way sphere + 600 procedural stars
    ├── AsteroidBelt.js     # InstancedMesh asteroid belt + meteors
    └── data/
        └── planets.js      # All planet / moon data + scale constants
```

### Scale Constants

```js
DIST_SCALE = 160       // 1 AU = 160 scene units
SIZE_SCALE = 0.00006   // kilometres → scene units
SUN_RADIUS ≈ 41.74     // 695,700 km × SIZE_SCALE
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A browser with **WebGPU support** for best quality (Chrome 113+, Edge 113+) — WebGL2 browsers work automatically via fallback

### Install & Run

```bash
git clone https://github.com/your-username/solar-system.git
cd solar-system
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Build for Production

```bash
npm run build   # outputs to dist/
npm run preview # local preview of the build
```

---

## Controls

| Input | Action |
|---|---|
| Left-click planet / moon | Fly to body, open info panel |
| Left-click empty space | Return to Sun view |
| Scroll wheel | Zoom in / out |
| Left-drag | Orbit camera |
| Middle-drag | Pan camera |
| W / A / S / D | Free-fly camera |
| Shift + WASD | Sprint |
| Sidebar search | Filter bodies by name |
| Sidebar row click | Fly to body |
| Time speed slider | Pause → 10,000× real-time |
| Orbits toggle | Show / hide orbit lines |

---

## Notable Implementation Details

- **InstancedMesh** for the asteroid belt — 3,000 objects with a single draw call
- **Starfield follows camera** every frame → true skybox illusion without a real skybox
- **No `.tif` textures** — Chrome cannot decode them; only JPG/PNG used (TIF loads produced a white-texture / diagonal stripe artifact)
- **`receiveShadow` disabled on planets** — avoids PointLight shadow cubemap seam artifacts; `castShadow` still enabled
- **AmbientLight** (`0x0d1830`, intensity 0.9) provides gentle fill light on planet dark sides
- **Moon retrograde** — Triton's negative `periodDays` naturally produces backwards orbit via sign flip on `orbitSpeed`

---

## License

MIT
