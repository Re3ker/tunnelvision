import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const _tmp = new THREE.Vector3();

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

    setForgiveness({ zOffset, zPadding, radiusFactor, coinZPadding } = {}) {
        if (typeof zOffset === 'number') this.zOffset = zOffset;
        if (typeof zPadding === 'number') this.zPadding = zPadding;
        if (typeof radiusFactor === 'number')
            this.playerRadiusFactor = radiusFactor;
        if (typeof coinZPadding === 'number') this.coinZPadding = coinZPadding;
    }

    // Player vs. disc barriers with circular holes
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
            const c = Math.cos(ang);
            const s = Math.sin(ang);
            const px = player.position.x * c + player.position.y * s;
            const py = -player.position.x * s + player.position.y * c;

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
            const rFromCenter = Math.hypot(px, py);
            if (rFromCenter <= (o.R || 0) - rp) {
                return true;
            }
        }

        return false;
    }

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
            const dist = Math.hypot(dx, dy);

            if (dist <= 0.45 + player.radius) {
                c.collected = true;
                count++;
            }
        }
        return count;
    }
}
