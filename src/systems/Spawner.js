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

    // Premium body material with subtle glow
    const bodyMat = new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.9,
        roughness: 0.35,
        clearcoat: 0.35,
        clearcoatRoughness: 0.12,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(color).multiplyScalar(0.08),
    });
    const body = new THREE.Mesh(geom, bodyMat);

    const group = new THREE.Group();
    group.add(body);

    // Accent glows: outer rim and hole edges
    const base = new THREE.Color(color);
    const glowColor = base.clone().lerp(new THREE.Color(0xffffff), 0.4);
    const outerMat = new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });

    // Outer rim (front and back)
    const rimInner = radius * 0.965;
    const rimOuter = radius * 1.01;
    const rimGeom = new THREE.RingGeometry(rimInner, rimOuter, 96);
    const rimFront = new THREE.Mesh(rimGeom, outerMat.clone());
    rimFront.position.z = depth / 2 + 0.02;
    rimFront.renderOrder = 10;
    const rimBack = new THREE.Mesh(rimGeom, outerMat.clone());
    rimBack.position.z = -depth / 2 - 0.02;
    rimBack.renderOrder = 10;
    rimBack.rotation.y = Math.PI;
    group.add(rimFront, rimBack);

    // Hole edge glows (front and back per hole)
    const holeMat = outerMat.clone();
    for (const h of holes) {
        const edgeInner = Math.max(0, h.r * 0.98);
        const edgeOuter = h.r * 1.08;
        const hg = new THREE.RingGeometry(edgeInner, edgeOuter, 80);
        const hf = new THREE.Mesh(hg, holeMat.clone());
        hf.position.set(h.x, h.y, depth / 2 + 0.015);
        hf.renderOrder = 10;
        const hb = new THREE.Mesh(hg, holeMat.clone());
        hb.position.set(h.x, h.y, -depth / 2 - 0.015);
        hb.renderOrder = 10;
        hb.rotation.y = Math.PI;
        group.add(hf, hb);
    }

    return group;
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
        // Elegant coin: larger radius, gold PBR, rim glint, and a star emblem
        const baseRadius = 0.5;
        const radius = baseRadius * 1.5; // +50%
        const height = 0.12;
        this.radius = radius;
        this.pickupRadius = radius + 0.07; // keep generous pickup window relative to size

        // Main body
        const bodyGeom = new THREE.CylinderGeometry(
            radius,
            radius,
            height,
            64,
            1
        );
        bodyGeom.rotateX(Math.PI / 2);
        const bodyMat = new THREE.MeshPhysicalMaterial({
            color: 0xffd76a,
            metalness: 0.8,
            roughness: 0.16,
            clearcoat: 0.6,
            clearcoatRoughness: 0.08,
            emissive: 0x3a2a00,
            emissiveIntensity: 0.42,
        });
        const body = new THREE.Mesh(bodyGeom, bodyMat);

        // Subtle rim glint on both faces
        const rimOuter = radius * 1.02;
        const rimInner = Math.max(0, radius * 0.94);
        const rimGeom = new THREE.RingGeometry(rimInner, rimOuter, 64);
        const rimMat = new THREE.MeshBasicMaterial({
            color: 0xffffcc,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
        });
        const rimFront = new THREE.Mesh(rimGeom, rimMat.clone());
        rimFront.position.z = height / 2 + 0.01;
        rimFront.renderOrder = 10;
        const rimBack = new THREE.Mesh(rimGeom, rimMat.clone());
        rimBack.position.z = -height / 2 - 0.01;
        rimBack.renderOrder = 10;
        rimBack.rotation.y = Math.PI; // ensure correct facing

        // Decorative inner ring groove on both faces
        const decoOuter = radius * 0.82;
        const decoInner = radius * 0.62;
        const decoGeom = new THREE.RingGeometry(decoInner, decoOuter, 64);
        const decoMat = new THREE.MeshStandardMaterial({
            color: 0xf0c96a,
            metalness: 0.9,
            roughness: 0.28,
            emissive: 0x241900,
            emissiveIntensity: 0.3,
        });
        const decoFront = new THREE.Mesh(decoGeom, decoMat);
        decoFront.position.z = height / 2 + 0.0015;
        const decoBack = new THREE.Mesh(decoGeom, decoMat.clone());
        decoBack.position.z = -height / 2 - 0.0015;
        decoBack.rotation.y = Math.PI;

        // Star emblem (five-point) extruded slightly, both faces
        const starShape = (() => {
            const s = new THREE.Shape();
            const points = [];
            const tips = 5;
            const rOuter = radius * 0.32;
            const rInner = radius * 0.13;
            for (let i = 0; i < tips * 2; i++) {
                const r = i % 2 === 0 ? rOuter : rInner;
                const a = (i / (tips * 2)) * Math.PI * 2 - Math.PI / 2;
                points.push(
                    new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)
                );
            }
            s.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++)
                s.lineTo(points[i].x, points[i].y);
            s.closePath();
            return s;
        })();
        const starGeom = new THREE.ExtrudeGeometry(starShape, {
            depth: 0.02,
            bevelEnabled: false,
            curveSegments: 32,
        });
        const starMat = new THREE.MeshStandardMaterial({
            color: 0xffdb74,
            metalness: 0.95,
            roughness: 0.24,
            emissive: 0x3d2900,
            emissiveIntensity: 0.3,
        });
        const starFront = new THREE.Mesh(starGeom, starMat);
        starFront.position.z = height / 2 + 0.003;
        const starBack = new THREE.Mesh(starGeom, starMat.clone());
        starBack.position.z = -height / 2 - 0.003;
        starBack.rotation.y = Math.PI;

        // Assemble
        this.mesh = new THREE.Group();
        this.mesh.add(
            body,
            rimFront,
            rimBack,
            decoFront,
            decoBack,
            starFront,
            starBack
        );
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

        // Simple, fixed controls for exact constant spacing
        this.barrierZStart = startZ; // z of first barrier (negative = ahead)
        this.barrierSpacingZ = 100; // exact constant spacing
        this.prefillCount = 8; // number of live barriers to maintain
        this.surfaceGapZ = 2; // reserved (kept for compatibility)

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

        this.debug = false;
        this.onBarrierPass = null;
        // Build chain on first reset()
    }

    setOnBarrierPass(cb) {
        this.onBarrierPass = typeof cb === 'function' ? cb : null;
    }

    setHoleTuning(cfg = {}) {
        Object.assign(this.holeCfg, cfg);
        this._rebuildChain();
    }

    setDebug(v) {
        this.debug = !!v;
        for (const o of this.obstacles) o.setDebug(this.debug);
    }

    // Back-compat stubs
    setSpawnDistances({ barrierZ } = {}) {
        if (typeof barrierZ === 'number') {
            this.barrierZStart = barrierZ;
            this._rebuildChain();
        }
    }
    setSpacing() {}
    setDifficulty() {}

    // Simple setters for clarity if needed externally
    setBarrierSpacing(v) {
        const minSpacing = this.barrierDepth + this.surfaceGapZ + 0.01;
        this.barrierSpacingZ = Math.max(minSpacing, Number(v));
        this._rebuildChain();
    }
    setPrefillCount(n) {
        this.prefillCount = Math.max(1, Number(n));
        this._rebuildChain();
    }
    setBarrierZStart(z) {
        this.barrierZStart = Number(z);
        this._rebuildChain();
    }
    setSurfaceGapZ(g) {
        this.surfaceGapZ = Math.max(0, Number(g));
        const minSpacing = this.barrierDepth + this.surfaceGapZ + 0.01;
        this.barrierSpacingZ = Math.max(minSpacing, this.barrierSpacingZ);
        this._rebuildChain();
    }

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

        // Prefill: use sampled hues so initial barriers aren't identical
        for (let i = 0; i < this.prefillCount; i++) {
            const colorHex = this.colorCycle
                ? this.colorCycle.sampleHex(i)
                : 0xff334d;
            const z = this.barrierZStart - i * this.barrierSpacingZ;
            this._spawnBarrierAt(z, colorHex);
        }
    }

    /** Advance positions, cull despawned items, and spawn new ones. */
    update(speed, dt) {
        if (this.obstacles.length === 0) this._rebuildChain();

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
        while (this.obstacles.length < this.prefillCount) {
            const last = this.obstacles[this.obstacles.length - 1];
            const z = last ? last.z - this.barrierSpacingZ : this.barrierZStart;

            // For runtime spawns, use current hue so barrier matches ring hue now
            const colorHex = this.colorCycle
                ? this.colorCycle.currentHex()
                : 0xff334d;

            this._spawnBarrierAt(z, colorHex);
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
