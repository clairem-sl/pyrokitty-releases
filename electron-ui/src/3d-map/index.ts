import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { TileManager } from './tile-manager';

// ── DOM Elements ─────────────────────────────────────────
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const coordsEl = document.getElementById('coords')!;
const selectionEl = document.getElementById('selection')!;
const selectionText = document.getElementById('selection-text')!;
const teleportBtn = document.getElementById('teleport-btn')!;

// ── Scene Setup ──────────────────────────────────────────
const scene = new THREE.Scene();
const bgColor = new THREE.Color(0x0e2a3f);
scene.background = bgColor;
scene.fog = new THREE.FogExp2(bgColor, 0.07);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
// Start position — later this will be the active avatar's location
const startX = 1028 + 6 / 256;
const startZ = -(918 + 201 / 256);
const gridCenter = new THREE.Vector3(startX, 0, startZ - 0.5);
camera.position.set(startX, 0.3, startZ + 0.5);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

// ── Controls ─────────────────────────────────────────────
const controls = new MapControls(camera, canvas);
controls.target.copy(gridCenter);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.minDistance = 1;
controls.maxDistance = 20;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.screenSpacePanning = false;
controls.update();

// ── Lighting (for shadows) ───────────────────────────────
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
sunLight.position.set(5, 10, 5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 512;
sunLight.shadow.mapSize.height = 512;
sunLight.shadow.camera.near = 0.1;
sunLight.shadow.camera.far = 30;
sunLight.shadow.camera.left = -2;
sunLight.shadow.camera.right = 2;
sunLight.shadow.camera.top = 2;
sunLight.shadow.camera.bottom = -2;
scene.add(sunLight);

// ── Avatar ───────────────────────────────────────────────
const avatarGroup = new THREE.Group();

const bodyGeom = new THREE.CapsuleGeometry(0.015, 0.04, 4, 8);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4cff4c });
const body = new THREE.Mesh(bodyGeom, bodyMat);
body.position.y = 0.035;
body.castShadow = true;
avatarGroup.add(body);

let avatarHeight = 0;
avatarGroup.position.copy(camera.position);
avatarGroup.position.y = avatarHeight;
scene.add(avatarGroup);

// ── WASD Movement ────────────────────────────────────────
const keys: Record<string, boolean> = {};
const MOVE_SPEED = 5;   // regions per second
const TURN_SPEED = 1.5; // radians per second
const FAST_MULT = 3;    // shift multiplier

window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

function updateMovement(dt: number): void {
  const fast = keys['ShiftLeft'] || keys['ShiftRight'] ? FAST_MULT : 1;
  const speed = MOVE_SPEED * fast * dt;

  // A/D: pan (rotate view left/right)
  if (keys['KeyA'] || keys['KeyD']) {
    const angle = TURN_SPEED * fast * dt * (keys['KeyA'] ? 1 : -1);
    const offset = new THREE.Vector3().subVectors(controls.target, camera.position);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    controls.target.copy(camera.position).add(offset);
  }

  // Forward direction projected onto ground plane
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const move = new THREE.Vector3();

  // E/C control avatar height only
  if (keys['KeyE'] || keys['Space']) avatarHeight = Math.max(0, avatarHeight + speed);
  if (keys['KeyC']) avatarHeight = Math.max(0, avatarHeight - speed);

  if (keys['KeyW']) move.add(forward);
  if (keys['KeyS']) move.sub(forward);

  if (move.lengthSq() === 0) return;

  move.normalize().multiplyScalar(speed);

  // Move both camera and target together (horizontal only)
  camera.position.add(move);
  controls.target.add(move);
}

// ── Tile Manager ─────────────────────────────────────────
const tileManager = new TileManager(scene);

// ── Selection Marker ─────────────────────────────────────
const markerGeom = new THREE.RingGeometry(0.05, 0.08, 32);
markerGeom.rotateX(-Math.PI / 2);
const markerMat = new THREE.MeshBasicMaterial({ color: 0x4c6ef5, side: THREE.DoubleSide });
const marker = new THREE.Mesh(markerGeom, markerMat);
marker.position.y = 0.01;
marker.visible = false;
scene.add(marker);

let selectedCoords: { gridX: number; gridY: number; localX: number; localY: number } | null = null;

// ── Raycaster ────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function updateMouse(event: MouseEvent): void {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

// ── Mouse Hover → Coordinate Display ────────────────────
canvas.addEventListener('mousemove', (event) => {
  updateMouse(event);
  raycaster.setFromCamera(mouse, camera);
  const hit = tileManager.raycast(raycaster);
  if (hit) {
    coordsEl.textContent = `Region (${hit.gridX}, ${hit.gridY})  Local (${hit.localX}, ${hit.localY}, 0)`;
  } else {
    coordsEl.textContent = '';
  }
});

// ── Click → Select Location ─────────────────────────────
canvas.addEventListener('click', (event) => {
  updateMouse(event);
  raycaster.setFromCamera(mouse, camera);
  const hit = tileManager.raycast(raycaster);
  if (hit) {
    selectedCoords = hit;
    marker.position.set(hit.gridX + hit.localX / 256, 0.01, -(hit.gridY + hit.localY / 256));
    marker.visible = true;

    selectionText.textContent = `(${hit.gridX}, ${hit.gridY}) [${hit.localX}, ${hit.localY}, 0]`;
    selectionEl.classList.remove('hidden');
  }
});

// ── Teleport Button ──────────────────────────────────────
teleportBtn.addEventListener('click', () => {
  if (!selectedCoords) return;
  try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('map:teleport', {
      gridX: selectedCoords.gridX,
      gridY: selectedCoords.gridY,
      localX: selectedCoords.localX,
      localY: selectedCoords.localY,
      localZ: 0,
    });
  } catch {
    // electron not available in dev
  }
});

// ── Fly-To Animation ─────────────────────────────────────
let flyTarget: THREE.Vector3 | null = null;
let flyStart: THREE.Vector3 | null = null;
let flyControlStart: THREE.Vector3 | null = null;
let flyProgress = 0;
const FLY_DURATION = 2.0; // seconds

export function flyTo(gridX: number, gridY: number): void {
  flyTarget = new THREE.Vector3(gridX, 0, -gridY);
  flyStart = camera.position.clone();
  flyControlStart = controls.target.clone();
  flyProgress = 0;
}

// Expose flyTo globally for IPC calls
(window as any).map3dFlyTo = flyTo;

function updateFly(dt: number): void {
  if (!flyTarget || !flyStart || !flyControlStart) return;

  flyProgress += dt / FLY_DURATION;
  if (flyProgress >= 1) {
    flyProgress = 1;
  }

  // Ease in-out
  const t = flyProgress < 0.5
    ? 2 * flyProgress * flyProgress
    : 1 - Math.pow(-2 * flyProgress + 2, 2) / 2;

  controls.target.lerpVectors(flyControlStart, flyTarget, t);

  const offset = new THREE.Vector3().subVectors(flyStart, flyControlStart);
  camera.position.copy(controls.target).add(offset);

  if (flyProgress >= 1) {
    flyTarget = null;
    flyStart = null;
    flyControlStart = null;
  }
}

// ── Animation Loop ───────────────────────────────────────
let lastTime = performance.now();
let tileUpdateAccum = 0;
const TILE_UPDATE_INTERVAL = 100; // ms

function animate(): void {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  updateMovement(dt);
  updateFly(dt);

  // E/C move avatar + camera together vertically (no tilt change)
  const heightDelta = avatarHeight - controls.target.y;
  if (heightDelta !== 0) {
    controls.target.y = avatarHeight;
    camera.position.y += heightDelta;
  }
  controls.update();

  // Update avatar position
  avatarGroup.position.set(controls.target.x, avatarHeight, controls.target.z);

  // Keep sun shadow centered on avatar
  sunLight.position.set(controls.target.x + 1, avatarHeight + 3, controls.target.z + 1);
  sunLight.target.position.copy(avatarGroup.position);
  sunLight.target.updateMatrixWorld();

  tileUpdateAccum += dt * 1000;
  if (tileUpdateAccum >= TILE_UPDATE_INTERVAL) {
    tileUpdateAccum = 0;
    tileManager.update(controls.target);
  }

  renderer.render(scene, camera);
}

// ── Resize ───────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Start ────────────────────────────────────────────────
animate();
