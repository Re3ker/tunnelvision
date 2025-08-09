import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

/**
 * Circular audio visualizer: renders a ring of bars around the tunnel radius,
 * positioned slightly behind it (negative Z). Bars scale with music spectrum.
 */
export class AudioVisualizer {
    constructor({ radius = 8.6, ringZ = -6, bins = 64 } = {}) {
        this.group = new THREE.Group();
        this.group.name = 'AudioVisualizer';
        this.radius = radius;
        this.ringZ = ringZ;
        this.bins = bins;

        // Geometry/material reused across bars
        const barWidth = ((Math.PI * 2 * radius) / bins) * 0.06; // narrow bars
        const barDepth = 0.15;
        const geom = new THREE.BoxGeometry(barWidth, 1, barDepth);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x76a7ff,
            transparent: true,
            opacity: 0.55,
        });

        this.bars = [];
        for (let i = 0; i < bins; i++) {
            const mesh = new THREE.Mesh(geom, mat.clone());
            const angle = (i / bins) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            mesh.position.set(x, y, ringZ);
            // Orient so local +Y points radially outward, so scaling Y grows outward
            // Compute rotation around Z so bar aligns tangentially then rotate -90deg
            mesh.rotation.z = angle - Math.PI / 2;
            this.group.add(mesh);
            this.bars.push(mesh);
        }
    }

    /** Update bar heights from a Uint8Array spectrum (0..255). */
    updateFromSpectrum(spectrum) {
        if (!spectrum || spectrum.length === 0) return;
        const n = this.bars.length;
        // Map spectrum into bars (downsample or wrap)
        for (let i = 0; i < n; i++) {
            const idx = Math.floor((i / n) * spectrum.length);
            const v = spectrum[idx] / 255; // 0..1
            const h = 0.2 + v * 1.6; // height scale (radial outward)
            const mesh = this.bars[i];
            mesh.scale.y = h;
            // Subtle color/opacity modulation
            const base = 0.45 + v * 0.4;
            mesh.material.opacity = base;
            const hue = 0.58 + v * 0.12; // blueish shift
            mesh.material.color.setHSL(hue % 1, 0.65, 0.55);
        }
    }
}
