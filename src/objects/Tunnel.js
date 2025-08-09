import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { ColorCycle } from '../core/ColorCycle.js';

/**
 * Decorative tunnel: a set of wireframe cylinder segments and glowing rings
 * that scroll towards the camera, with ring colors driven by a shared
 * ColorCycle. This is purely visual and doesn't affect gameplay physics.
 */
export class Tunnel {
    constructor({
        radius = 8,
        segmentLength = 40,
        segments = 8,
        colorCycle = new ColorCycle(),
        ringSpacing = 12,
    } = {}) {
        this.radius = radius;
        this.segmentLength = segmentLength;
        this.segments = segments;
        this.colorCycle = colorCycle;
        this.ringSpacing = ringSpacing;

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
            64, // smoother radial detail
            1, // minimal height segments (we reuse geometry per segment)
            true
        );
        // Align cylinder along Z axis
        geom.rotateX(Math.PI / 2);

        this.segMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xffffff, // will be tinted by colorCycle in update()
            metalness: 0.0,
            roughness: 0.06,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.14,
            transmission: 0.75, // glass-like
            thickness: 0.25,
            ior: 1.2,
        });

        this.segmentsList = [];
        for (let i = 0; i < this.segments; i++) {
            const m = new THREE.Mesh(geom, this.segMaterial);
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
        const ringCount = 24;
        for (let i = 0; i < ringCount; i++) {
            // Sample initial colors without mutating the shared hue
            const hex = this.colorCycle.sampleHex(i);
            const mat = new THREE.MeshBasicMaterial({
                color: hex,
                transparent: true,
                opacity: 0.35,
                side: THREE.DoubleSide,
            });

            // Clone geometry so each ring can deform independently
            const geom = torusGeom.clone();
            // Snapshot base positions for deformation reference
            const baseAttr = geom.attributes.position;
            const baseArray = new Float32Array(baseAttr.array.length);
            baseArray.set(baseAttr.array);

            const r = new THREE.Mesh(geom, mat);
            r.quaternion.premultiply(qFaceForward);
            r.position.z = -i * this.ringSpacing;
            // Per-ring deformation state
            r.userData.basePositions = baseArray;
            r.userData.jagSeed = Math.random() * 1000;
            r.userData.jagPhase = Math.random() * Math.PI * 2;
            r.userData.jagCurrent = 0; // smoothed amplitude
            ringGroup.add(r);
            this.rings.push(r);
        }
    }

    reset() {
        for (let i = 0; i < this.segmentsList.length; i++) {
            this.segmentsList[i].position.z = -i * this.segmentLength;
        }
        for (let i = 0; i < this.rings.length; i++) {
            this.rings[i].position.z = -i * this.ringSpacing;
            // Re-apply sampled color in case hue changed before reset
            const hex = this.colorCycle.sampleHex(i);
            this.rings[i].material.color.setHex(hex);
        }
        this._time = 0;
    }

    /** Scroll segments/rings forward and recycle them to the back. */
    update(speed, dt, spectrum = null) {
        this._time += dt;
        const segLen = this.segmentLength;

        // Move and recycle cylinder segments
        for (const m of this.segmentsList) {
            m.position.z += speed * dt;
            if (m.position.z > segLen / 2) {
                const backmost =
                    Math.min(...this.segmentsList.map((s) => s.position.z)) -
                    segLen;
                m.position.z = backmost;
            }
        }

        // Rings (no audio reactivity)
        const ringCount = this.rings.length;
        for (let i = 0; i < ringCount; i++) {
            const r = this.rings[i];

            // Move and recycle ring
            r.position.z += speed * dt * 1.05;
            if (r.position.z > 2) {
                const backmost =
                    Math.min(...this.rings.map((x) => x.position.z)) -
                    this.ringSpacing;
                r.position.z = backmost;
                const nextHex = this.colorCycle.advance();
                r.material.color.setHex(nextHex);
            }

            // Constant opacity; no geometry deformation
            r.material.opacity = 1;

            // One-time restore to pristine geometry (in case it was deformed previously)
            if (r.userData.basePositions && !r.userData._restored) {
                const geom = r.geometry;
                const posAttr = geom.attributes.position;
                const base = r.userData.basePositions;
                const count = posAttr.count;
                for (let v = 0; v < count; v++) {
                    posAttr.setXYZ(
                        v,
                        base[v * 3 + 0],
                        base[v * 3 + 1],
                        base[v * 3 + 2]
                    );
                }
                posAttr.needsUpdate = true;
                if (!geom.boundingSphere) geom.computeBoundingSphere();
                r.userData._restored = true;
            }
        }

        // Tint glass by current rainbow color (no emissive pulse)
        if (this.segMaterial && this.colorCycle?.currentHex) {
            this.segMaterial.color.setHex(this.colorCycle.currentHex());
        }
    }
}
