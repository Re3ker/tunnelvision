import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { ColorCycle } from '../core/ColorCycle.js';

export class Tunnel {
    constructor({
        radius = 8,
        segmentLength = 40,
        segments = 8,
        colorCycle = new ColorCycle(),
    } = {}) {
        this.radius = radius;
        this.segmentLength = segmentLength;
        this.segments = segments;
        this.colorCycle = colorCycle;

        this.group = new THREE.Group();
        this.group.matrixAutoUpdate = true;

        this._createSegments();
        this._createGlowRings();
        this._time = 0;
    }

    _createSegments() {
        this.segGroup = new THREE.Group();
        this.group.add(this.segGroup);

        const geom = new THREE.CylinderGeometry(
            this.radius,
            this.radius,
            this.segmentLength,
            32,
            4,
            true
        );
        // Align cylinder along Z axis
        geom.rotateX(Math.PI / 2);

        const mat = new THREE.MeshStandardMaterial({
            color: 0x0f1320,
            metalness: 0.1,
            roughness: 0.8,
            side: THREE.BackSide,
            wireframe: true,
        });

        this.segmentsList = [];
        for (let i = 0; i < this.segments; i++) {
            const m = new THREE.Mesh(geom, mat);
            m.position.z = -i * this.segmentLength;
            this.segGroup.add(m);
            this.segmentsList.push(m);
        }
    }

    _createGlowRings() {
        const ringGroup = new THREE.Group();
        this.group.add(ringGroup);

        const torusGeom = new THREE.TorusGeometry(
            this.radius * 0.98,
            0.08,
            10,
            72
        );

        // Rotate torus so its axis points towards -Z
        const qFaceForward = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, -1, 0)
        );

        this.rings = [];
        const count = 20;
        for (let i = 0; i < count; i++) {
            // Sample initial colors without mutating the shared hue
            const hex = this.colorCycle.sampleHex(i);
            const mat = new THREE.MeshBasicMaterial({
                color: hex,
                transparent: true,
                opacity: 0.35,
                side: THREE.DoubleSide,
            });

            const r = new THREE.Mesh(torusGeom, mat);
            r.quaternion.premultiply(qFaceForward);
            r.position.z = -i * 10;
            ringGroup.add(r);
            this.rings.push(r);
        }
    }

    reset() {
        for (let i = 0; i < this.segmentsList.length; i++) {
            this.segmentsList[i].position.z = -i * this.segmentLength;
        }
        for (let i = 0; i < this.rings.length; i++) {
            this.rings[i].position.z = -i * 10;
            // Re-apply sampled color in case hue changed before reset
            const hex = this.colorCycle.sampleHex(i);
            this.rings[i].material.color.setHex(hex);
        }
        this._time = 0;
    }

    update(speed, dt) {
        this._time += dt;
        const segLen = this.segmentLength;

        for (const m of this.segmentsList) {
            m.position.z += speed * dt;
            if (m.position.z > segLen / 2) {
                let backmost =
                    Math.min(...this.segmentsList.map((s) => s.position.z)) -
                    segLen;
                m.position.z = backmost;
            }
            m.rotation.z += 0.05 * dt;
        }

        for (const r of this.rings) {
            r.position.z += speed * dt * 1.05;
            if (r.position.z > 2) {
                // A ring "spawns" (wraps) -> advance the global hue
                let backmost =
                    Math.min(...this.rings.map((x) => x.position.z)) - 10;
                r.position.z = backmost;
                const nextHex = this.colorCycle.advance();
                r.material.color.setHex(nextHex);
            }
            // Slight opacity pulse
            const base = 0.28 + 0.07 * Math.sin(this._time * 3.0);
            r.material.opacity = base;
        }
    }
}
