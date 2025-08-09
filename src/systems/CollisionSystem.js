import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const _tmp = new THREE.Vector3();

/**
 * CollisionSystem
 *
 * Provides two queries:
 * - checkObstacles: player vs. spinning disc barriers with circular holes
 * - collectCoins: mark nearby coins as collected and return count
 *
 * Uses a forgiving z-window and shrinks the player radius slightly to keep
 * gameplay fair. Public API is stable; names expanded for clarity only.
 */
export class CollisionSystem {
    constructor() {
        // Center of the collision plane along z (negative = forward into tunnel)
        this.zOffset = -0.6;

        // Extra half-thickness tolerance added to barrier depth
        this.zPadding = 0.18;

        // Shrink player radius a little to be forgiving vs. barriers
        this.playerRadiusFactor = 0.9;

        // Coin window (keep broad so you can grab them)
        this.coinZPadding = 1.2;
    }

    /** Configure tolerance and offsets used during collision tests. */
    setForgiveness({ zOffset, zPadding, radiusFactor, coinZPadding } = {}) {
        if (typeof zOffset === 'number') this.zOffset = zOffset;
        if (typeof zPadding === 'number') this.zPadding = zPadding;
        if (typeof radiusFactor === 'number')
            this.playerRadiusFactor = radiusFactor;
        if (typeof coinZPadding === 'number') this.coinZPadding = coinZPadding;
    }

    // Player vs. disc barriers with circular holes
    /** Return true if player collides with any barrier disc. */
    checkObstacles(obstacles, player) {
        const rp = (player.radius || 0.35) * this.playerRadiusFactor;

        for (const o of obstacles) {
            if (o.type !== 'disc') continue;

            const halfD = (o.depth || 1.8) / 2;
            const halfWindow = halfD + this.zPadding;

            // Only test while the disc volume overlaps the shifted z plane
            if (Math.abs(o.z - this.zOffset) > halfWindow) continue;

            // Rotate player position into obstacle's frame
            const ang = o.angle || 0;
            const cosA = Math.cos(ang);
            const sinA = Math.sin(ang);
            const px = player.position.x * cosA + player.position.y * sinA;
            const py = -player.position.x * sinA + player.position.y * cosA;

            // If player's circle is fully inside any hole -> safe
            let insideHole = false;
            for (const h of o.holes || []) {
                const d = Math.hypot(px - h.x, py - h.y);
                if (d <= Math.max(0, (h.r || 0) - rp)) {
                    insideHole = true;
                    break;
                }
            }
            if (insideHole) continue;

            // Otherwise, if inside solid disc -> collision
            const radiusFromCenter = Math.hypot(px, py);
            if (radiusFromCenter <= (o.R || 0) - rp) {
                return true;
            }
        }

        return false;
    }

    /** Mark coins within pickup radius as collected; return the count. */
    collectCoins(coins, player) {
        let count = 0;
        for (const c of coins) {
            if (c.collected) continue;

            // Use tracked world-z (updated by Spawner) for z window test
            if (Math.abs(c.z) > this.coinZPadding) continue;

            // Coins may be parented to barriers; get world position
            c.mesh.getWorldPosition(_tmp);
            const dx = _tmp.x - player.position.x;
            const dy = _tmp.y - player.position.y;
            const planarDistance = Math.hypot(dx, dy);

            if (planarDistance <= 0.45 + player.radius) {
                c.collected = true;
                count++;
            }
        }
        return count;
    }
}
