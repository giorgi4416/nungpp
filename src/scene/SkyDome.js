import * as THREE from 'three';

/**
 * Art-directed gradient sky with sun glow. Unlike a physical sky model its
 * radiance stays in a controlled range, so it can also be used to build the
 * PMREM environment map without flooding the scene with light.
 */
export function createSkyDome(sunDir, { radius = 4500, zenith = 0x2f6fc4, horizon = 0xd6e6f3, ground = 0xb9cde0 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(zenith) },
      uHorizon: { value: new THREE.Color(horizon) },
      uGround: { value: new THREE.Color(ground) },
      uSun: { value: sunDir.clone().normalize() },
      uSunColor: { value: new THREE.Color(0xfff3dc) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // keep the dome on the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGround, uSun, uSunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0
          ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55))
          : mix(uHorizon, uGround, clamp(-h * 6.0, 0.0, 1.0));
        float sd = max(dot(d, uSun), 0.0);
        col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 40.0) * 0.18 + pow(sd, 6.0) * 0.06);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/** Build a PMREM environment from the same sky plus a dark ground hemisphere. */
export function createEnvironmentMap(renderer, sunDir, colors = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky = createSkyDome(sunDir, { radius: 100, zenith: colors.zenith ?? 0x2f6fc4, horizon: colors.horizon ?? 0xd6e6f3, ground: colors.fog ?? 0xb9cde0 });
  sky.material.toneMapped = false;
  envScene.add(sky);
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x55663a, side: THREE.BackSide });
  const ground = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.02, Math.PI / 2), groundMat);
  envScene.add(ground);
  const rt = pmrem.fromScene(envScene, 0.03, 0.1, 200);
  sky.geometry.dispose();
  sky.material.dispose();
  ground.geometry.dispose();
  groundMat.dispose();
  pmrem.dispose();
  return rt.texture;
}
