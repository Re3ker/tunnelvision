import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

/** Debug helper: draw a circle line for collision radius visualization. */
function makeCircleLine(radius, color = 0x00ffff, segments = 96) {
    const positions = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        positions[i * 3 + 0] = Math.cos(t) * radius;
        positions[i * 3 + 1] = Math.sin(t) * radius;
        positions[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
    });
    return new THREE.LineLoop(geo, mat);
}

/**
 * Player
 *
 * Represents the player cursor in the XY plane (at z=0). Movement is clamped
 * to an allowed radius inside the tunnel. Includes a debug mesh to visualize
 * the collision circle used by gameplay systems.
 */
export class Player {
    constructor({ radius = 8, margin = 1.2 } = {}) {
        this.allowedRadius = radius - margin;

        this.position = new THREE.Vector3(0, 0, 0);

        // Immediate response tuning
        this.immediateGain = 22; // world units per normalized mouse delta

        // Collision circle radius used by systems (coins add their own)
        this.radius = 0.35;

        // Debug: show player collision circle
        this.debugMesh = makeCircleLine(this.radius, 0x00ffcc, 96);
        this.debugMesh.visible = false;
        this.debugScaleFactor = 1.0;
    }

    setDebugCollisionFactor(f) {
        this.debugScaleFactor = Math.max(0.1, f || 1.0);
        this.debugMesh.scale.set(
            this.debugScaleFactor,
            this.debugScaleFactor,
            1
        );
    }

    reset() {
        this.position.set(0, 0, 0);
        this.debugMesh.position.set(0, 0, 0);
    }

    // Absolute mode: jump directly to target within allowed circle
    updateAbsolute(target) {
        let targetX = target.x * this.allowedRadius;
        let targetY = target.y * this.allowedRadius;

        const length = Math.hypot(targetX, targetY);
        if (length > this.allowedRadius) {
            const scale = this.allowedRadius / length;
            targetX *= scale;
            targetY *= scale;
        }

        this.position.x = targetX;
        this.position.y = targetY;
        this.debugMesh.position.copy(this.position);
    }

    // Relative mode: immediate translation by mouse delta
    updateRelative(delta) {
        this.position.x += delta.x * this.immediateGain;
        this.position.y += delta.y * this.immediateGain;

        // Clamp to allowed circle
        const radial = Math.hypot(this.position.x, this.position.y);
        const maxRadius = this.allowedRadius;
        if (radial > maxRadius) {
            const scale = maxRadius / radial;
            this.position.x *= scale;
            this.position.y *= scale;
        }

        this.debugMesh.position.copy(this.position);
    }
}
