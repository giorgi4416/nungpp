import * as THREE from 'three';
import { createSkyDome, createEnvironmentMap } from './SkyDome.js';
import { setMaxAnisotropy } from './Textures.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadowMap: 1024, shadowRange: 70, trees: 0.45, crowd: 0.4, fogFar: 1700, antialias: false, shadows: true },
  medium: { pixelRatio: 1.0, shadowMap: 2048, shadowRange: 95, trees: 0.75, crowd: 0.75, fogFar: 2300, antialias: true, shadows: true },
  high: { pixelRatio: 1.5, shadowMap: 4096, shadowRange: 120, trees: 1.0, crowd: 1.0, fogFar: 2800, antialias: true, shadows: true },
};

export const SUN_DIRECTION = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(215));

/**
 * Renderer, scene, camera, gradient sky dome, fog and an environment map
 * (PMREM from the same sky) so that car paint and metal get believable reflections.
 */
export function createScene(canvas, qualityName) {
  const q = QUALITY[qualityName] || QUALITY.medium;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(2, Math.min(window.devicePixelRatio || 1, 2) * q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0xc9dbea);
  scene.fog = new THREE.Fog(fogColor, 380, q.fogFar);
  scene.background = fogColor;

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);
  camera.position.set(0, 30, 60);

  return { renderer, scene, camera, quality: q };
}

/**
 * Per-circuit sky: gradient dome, sun direction, fog colour and a matching
 * environment map. Replaces the previous circuit's sky.
 * @param sky {zenith, horizon, fog, sunElevation, sunAzimuth}
 */
export function setSky(renderer, scene, sky) {
  const ud = scene.userData;
  if (ud.sky) {
    ud.sky.removeFromParent();
    ud.sky.geometry.dispose();
    ud.sky.material.dispose();
  }
  if (scene.environment) scene.environment.dispose();
  SUN_DIRECTION.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sky.sunElevation), THREE.MathUtils.degToRad(sky.sunAzimuth));
  const dome = createSkyDome(SUN_DIRECTION, { zenith: sky.zenith, horizon: sky.horizon, ground: sky.fog });
  scene.add(dome);
  ud.sky = dome;
  scene.environment = createEnvironmentMap(renderer, SUN_DIRECTION, sky);
  scene.environmentIntensity = 0.9;
  scene.fog.color.setHex(sky.fog);
  scene.background = scene.fog.color;
}

export function applyQuality(renderer, scene, qualityName) {
  const q = QUALITY[qualityName] || QUALITY.medium;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(Math.min(2, dpr * q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  scene.fog.far = q.fogFar;
  return q;
}
