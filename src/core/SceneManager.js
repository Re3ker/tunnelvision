import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06070a);
    this.scene.fog = new THREE.Fog(0x06070a, 30, 220);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0x8a9bb2, 0.3);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xb0c7ff, 1.0);
    dir.position.set(6, 8, 10);
    this.scene.add(dir);

    this._resizeCbs = [];
    window.addEventListener("resize", () => this.resize());
  }

  onResize(cb) {
    this._resizeCbs.push(cb);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    for (const cb of this._resizeCbs) cb();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
