import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

/** Random float in [min, max). */
function rand(min, max) {
    return min + Math.random() * (max - min);
}

/** Create an extruded disc mesh with circular holes. */
function makeDiscMesh({ radius, depth = 1.8, holes, color }) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, radius, 0, Math.PI * 2, false);

    for (const h of holes) {
        const path = new THREE.Path();
        path.absarc(h.x, h.y, h.r, 0, Math.PI * 2, true);
        shape.holes.push(path);
    }

    const geom = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: false,
        curveSegments: 64,
    });
    geom.translate(0, 0, -depth / 2);

    const mat = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.25,
        roughness: 0.6,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(color).multiplyScalar(0.15),
    });

    return new THREE.Mesh(geom, mat);
}

/** Utility: thin circle line used for debug overlays. */
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

/** Logical + visual representation of a spinning barrier disc. */
class BarrierDisc {
    constructor({
        radius,
        depth = 1.8,
        holes,
        color,
        initialAngle = 0,
        spin = 0,
        debug = false,
    }) {
        this.type = 'disc';
        this.R = radius;
        this.depth = depth;
        this.holes = holes;
        this.z = -200;
        this.angle = initialAngle;
        this.spin = spin;
        // Tag that flips to true once the disc crosses z=0 for SFX trigger
        this.passedSound = false;

        this.mesh = makeDiscMesh({ radius, depth, holes, color });
        this.mesh.rotation.z = this.angle;
        this.mesh.position.set(0, 0, this.z);

        this.debugNode = new THREE.Group();
        this.debugNode.name = 'dbg';
        this.debugNode.visible = !!debug;
        this.mesh.add(this.debugNode);

        const rim = makeCircleLine(radius, 0x00ffcc, 96);
        this.debugNode.add(rim);
        for (const h of holes) {
            const hole = makeCircleLine(h.r, 0xffffff, 72);
            hole.position.set(h.x, h.y, 0);
            this.debugNode.add(hole);
        }
    }

    setZ(z) {
        this.z = z;
        this.mesh.position.z = z;
    }

    setAngle(theta) {
        this.angle = theta;
        this.mesh.rotation.z = theta;
    }

    setDebug(v) {
        this.debugNode.visible = !!v;
    }
}

/** A spinning collectible coin that may be parented to a barrier. */
class Coin {
    constructor({ x, y, z }) {
        this.type = 'coin';
        this.z = z;

        // Flat cylinder coin (faces XY plane)
        const radius = 0.38;
        const height = 0.12;
        const geom = new THREE.CylinderGeometry(radius, radius, height, 28, 1);
        geom.rotateX(Math.PI / 2);

        const mat = new THREE.MeshStandardMaterial({
            color: 0xffd166,
            metalness: 0.7,
            roughness: 0.28,
            emissive: 0x3a2a00,
            emissiveIntensity: 0.35,
        });

        this.mesh = new THREE.Mesh(geom, mat);
        this.mesh.position.set(x, y, z);
        this.collected = false;

        this.parentBarrier = null;
        this.localZ = 0; // local z relative to parent barrier when parented

        this.spinY = rand(4.5, 7.0) * (Math.random() < 0.5 ? -1 : 1);
        this.spinZ = rand(0.6, 1.6);
    }

    setZ(z) {
        this.z = z;
        this.mesh.position.z = z;
    }
}

/**
 * Spawner
 *
 * Maintains a constant chain of equally-spaced barrier discs in the tunnel
 * and populates coins inside barrier holes. The chain is rebuilt when any
 * "ctrl" property changes or on reset. Update() advances items and prunes
 * off-screen ones, then spawns new ones to keep a fixed count.
 */
export class Spawner {
    constructor({
        tunnelRadius,
        startZ = -200,
        despawnZ = 6,
        colorCycle, // shared color cycle
    } = {}) {
        this.group = new THREE.Group();
        this.tunnelRadius = tunnelRadius;
        this.despawnZ = despawnZ;
        this.colorCycle = colorCycle;

        // Global controls (live via game.spawner.ctrl.*)
        this.ctrl = {
            barrierZ: startZ, // z of first barrier (negative = ahead)
            barrierSpacingZ: 300, // EXACT constant spacing
            prefillCount: 8, // number of live barriers
            surfaceGapZ: 2,
        };

        // Hole tuning
        this.holeCfg = {
            edgeMarginAbs: 0.35,
            ringWidthFracMin: 0.52,
            ringWidthFracMax: 0.68,
            twinRadiusFracMin: 0.18,
            twinRadiusFracMax: 0.26,
            twinMinGapFrac: 0.12,
            offRadiusFracMin: 0.22,
            offRadiusFracMax: 0.32,
        };

        this.barrierDepth = 1.8;

        this.obstacles = [];
        this.coins = [];

        this._nextSpawnZ = this.ctrl.barrierZ;
        this.debug = false;
        this.onBarrierPass = null;

        this._needsRebuild = true;
        this._defineCtrlAccessors();
    }

    /** Define reactive accessors for live tweaking via this.ctrl.* */
    _defineCtrlAccessors() {
        const clampSpacing = (v) =>
            Math.max(
                this.barrierDepth + this.ctrl.surfaceGapZ + 0.01,
                Number(v)
            );
        Object.defineProperties(this.ctrl, {
            barrierZ: {
                get: () => this._barrierZ ?? -200,
                set: (v) => {
                    this._barrierZ = Number(v);
                    this._needsRebuild = true;
                },
                configurable: true,
            },
            barrierSpacingZ: {
                get: () => this._barrierSpacingZ ?? 300,
                set: (v) => {
                    this._barrierSpacingZ = clampSpacing(v);
                    this._needsRebuild = true;
                },
                configurable: true,
            },
            prefillCount: {
                get: () => this._prefillCount ?? 8,
                set: (v) => {
                    this._prefillCount = Math.max(1, Number(v));
                    this._needsRebuild = true;
                },
                configurable: true,
            },
            surfaceGapZ: {
                get: () => this._surfaceGapZ ?? 2,
                set: (v) => {
                    this._surfaceGapZ = Math.max(0, Number(v));
                    this._barrierSpacingZ = Math.max(
                        this.barrierDepth + this._surfaceGapZ + 0.01,
                        this._barrierSpacingZ ?? 300
                    );
                    this._needsRebuild = true;
                },
                configurable: true,
            },
        });

        // Initialize mirrors (trigger setters once to seed privates)
        this.ctrl.barrierZ = this.ctrl.barrierZ;
        this.ctrl.barrierSpacingZ = this.ctrl.barrierSpacingZ;
        this.ctrl.prefillCount = this.ctrl.prefillCount;
        this.ctrl.surfaceGapZ = this.ctrl.surfaceGapZ;
    }

    setOnBarrierPass(cb) {
        this.onBarrierPass = typeof cb === 'function' ? cb : null;
    }

    setHoleTuning(cfg = {}) {
        Object.assign(this.holeCfg, cfg);
        this._needsRebuild = true;
    }

    setDebug(v) {
        this.debug = !!v;
        for (const o of this.obstacles) o.setDebug(this.debug);
    }

    // Back-compat stubs
    setSpawnDistances({ barrierZ } = {}) {
        if (typeof barrierZ === 'number') this.ctrl.barrierZ = barrierZ;
    }
    setSpacing() {}
    setDifficulty() {}

    /**
     * Clear existing meshes and recreate a prefilled, evenly spaced chain.
     */
    reset() {
        this._rebuildChain();
    }

    /** Remove all current barriers/coins and prefill new ones. */
    _rebuildChain() {
        for (const o of this.obstacles) this.group.remove(o.mesh);
        for (const c of this.coins)
            if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
        this.obstacles.length = 0;
        this.coins.length = 0;

        this._nextSpawnZ = this.ctrl.barrierZ;

        // Prefill: use sampled hues so initial barriers aren't identical
        for (let i = 0; i < this.ctrl.prefillCount; i++) {
            const colorHex = this.colorCycle
                ? this.colorCycle.sampleHex(i)
                : 0xff334d;
            this._spawnBarrierAt(this._nextSpawnZ, colorHex);
            this._nextSpawnZ -= this.ctrl.barrierSpacingZ;
        }
        this._needsRebuild = false;
    }

    /** Advance positions, cull despawned items, and spawn new ones. */
    update(speed, dt) {
        if (this._needsRebuild || this.obstacles.length === 0) {
            this._rebuildChain();
        }

        for (const o of this.obstacles) {
            const prevZ = o.z;
            o.setZ(o.z + speed * dt);
            if (o.spin !== 0) o.setAngle(o.angle + o.spin * dt);

            if (!o.passedSound && prevZ < 0 && o.z >= 0) {
                o.passedSound = true;
                if (this.onBarrierPass) this.onBarrierPass(o);
            }
        }

        for (const c of this.coins) {
            if (c.parentBarrier) c.z = c.parentBarrier.z + (c.localZ || 0);
            c.mesh.rotation.y += c.spinY * dt;
            c.mesh.rotation.z += c.spinZ * dt;
        }

        // Remove out-of-range obstacles and detach from scene
        this.obstacles = this.obstacles.filter((o) => {
            if (o.z > this.despawnZ) {
                this.group.remove(o.mesh);
                return false;
            }
            return true;
        });
        // Remove collected or out-of-range coins and detach
        this.coins = this.coins.filter((c) => {
            const zw = c.parentBarrier ? c.parentBarrier.z : c.z;
            if (zw > this.despawnZ || c.collected) {
                if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
                return false;
            }
            return true;
        });

        // Maintain constant-spacing chain
        while (this.obstacles.length < this.ctrl.prefillCount) {
            const last = this.obstacles[this.obstacles.length - 1];
            const z = last
                ? last.z - this.ctrl.barrierSpacingZ
                : this.ctrl.barrierZ;

            // For runtime spawns, use current hue so barrier matches ring hue now
            const colorHex = this.colorCycle
                ? this.colorCycle.currentHex()
                : 0xff334d;

            this._spawnBarrierAt(z, colorHex);
            this._nextSpawnZ = z - this.ctrl.barrierSpacingZ;
        }
    }

    /** Create one barrier mesh + its coins and attach them to the scene. */
    _spawnBarrierAt(z, colorHex) {
        const R = this.tunnelRadius;
        const depth = this.barrierDepth;
        const edge = this.holeCfg.edgeMarginAbs;
        const holes = [];

        const p = Math.random();

        if (p < 0.45) {
            // Two opposite holes with no overlap
            let rHole =
                R *
                rand(
                    this.holeCfg.twinRadiusFracMin,
                    this.holeCfg.twinRadiusFracMax
                );
            const minGap = this.holeCfg.twinMinGapFrac * R;
            const roMax = Math.max(0, R - rHole - edge);
            const rHoleMaxAllowed = Math.max(0.1 * R, roMax - minGap);
            rHole = Math.min(rHole, rHoleMaxAllowed);

            const roMin = Math.max(rHole + minGap, 0.22 * R);
            const ro = roMin <= roMax ? rand(roMin, roMax) : roMax;

            const a = Math.random() * Math.PI * 2;
            const cx = Math.cos(a) * ro;
            const cy = Math.sin(a) * ro;

            holes.push({ x: cx, y: cy, r: rHole });
            holes.push({ x: -cx, y: -cy, r: rHole });
        } else if (p < 0.8) {
            // Single centered hole (ring)
            const ringWidth =
                R *
                rand(
                    this.holeCfg.ringWidthFracMin,
                    this.holeCfg.ringWidthFracMax
                );
            const rHole = Math.max(edge, R - ringWidth);
            holes.push({ x: 0, y: 0, r: rHole });
        } else {
            // Single off-center hole
            const rHole =
                R *
                rand(
                    this.holeCfg.offRadiusFracMin,
                    this.holeCfg.offRadiusFracMax
                );
            const roMax = Math.max(0, R - rHole - edge);
            const roMin = Math.min(roMax, R * 0.28);
            const ro = roMin + Math.random() * Math.max(0.001, roMax - roMin);
            const a = Math.random() * Math.PI * 2;
            const cx = Math.cos(a) * ro;
            const cy = Math.sin(a) * ro;
            holes.push({ x: cx, y: cy, r: rHole });
        }

        const initialAngle = Math.random() * Math.PI * 2;
        const spin = (Math.random() * 2 - 1) * 0.6;

        const color = colorHex ?? 0xff334d;

        const o = new BarrierDisc({
            radius: R,
            depth,
            holes,
            color,
            initialAngle,
            spin,
            debug: this.debug,
        });

        o.setZ(z);
        this.obstacles.push(o);
        this.group.add(o.mesh);

        // Coins in holes: parent to the barrier so they ride along
        for (const h of holes) {
            const coin = new Coin({ x: h.x, y: h.y, z: 0 });
            o.mesh.add(coin.mesh);
            coin.parentBarrier = o;
            coin.localZ = 0;
            coin.z = z;
            this.coins.push(coin);
        }
    }
}
