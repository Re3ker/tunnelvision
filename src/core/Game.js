import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { SceneManager } from './SceneManager.js';
import { Input } from './Input.js';
import { AudioSystem } from './Audio.js';
import { Tunnel } from '../objects/Tunnel.js';
import { Player } from '../objects/Player.js';
import { Spawner } from '../systems/Spawner.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { HUD } from '../ui/HUD.js';
import { ColorCycle } from './ColorCycle.js';

export class Game {
    constructor(ui) {
        this.ui = ui;
        this.sceneMgr = new SceneManager();
        this.input = new Input(this.sceneMgr.renderer.domElement);
        this.audio = new AudioSystem();
        this.hud = new HUD(ui);

        this.scene = this.sceneMgr.scene;
        this.camera = this.sceneMgr.camera;

        // Shared color cycle (tweak live: game.color.hueStep = 0.03, etc.)
        this.color = new ColorCycle({
            hue: 0.0,
            hueStep: 0.02,
            saturation: 0.9,
            lightness: 0.55,
        });

        this.tunnel = new Tunnel({
            radius: 8,
            segmentLength: 40,
            segments: 8,
            colorCycle: this.color,
        });
        this.scene.add(this.tunnel.group);

        this.player = new Player({
            radius: 8,
            margin: 1.2,
        });
        this.scene.add(this.player.debugMesh);

        this.spawner = new Spawner({
            tunnelRadius: 8,
            startZ: -200,
            despawnZ: 6,
            colorCycle: this.color,
        });
        this.scene.add(this.spawner.group);

        // Woosh when a barrier passes the player
        this.spawner.setOnBarrierPass(() => {
            this.audio.playWoosh(this.worldSpeed);
        });

        this.collision = new CollisionSystem();
        this.collision.setForgiveness({
            zOffset: -0.6,
            zPadding: 0.18,
            radiusFactor: 0.9,
            coinZPadding: 1.2,
        });
        this.player.setDebugCollisionFactor(0.9);

        this._debug = false;
        Object.defineProperty(this, 'debug', {
            get: () => this._debug,
            set: (v) => {
                this._debug = !!v;
                this.applyDebug();
            },
        });

        this.state = 'menu';
        this.resetProgress();

        this.lastTime = performance.now();

        this.sceneMgr.onResize(this.onSceneResized.bind(this));
        this.sceneMgr.resize();

        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);

        this.toMenu();
    }

    applyDebug() {
        this.player.debugMesh.visible = this._debug;
        this.spawner.setDebug(this._debug);
    }

    resetProgress() {
        this.worldSpeed = 30;
        this.speedUpPerSec = 0.65;
        this.score = 0;
        this.coins = 0;
        this.bestScore =
            parseInt(localStorage.getItem('bestScore') || '0', 10) || 0;
        this.spawnBias = 1.0;
        this.distanceTravelled = 0;
    }

    setSensitivity(s) {
        this.input.setSensitivity(s);
    }
    setInvertY(inv) {
        this.input.setInvertY(inv);
    }
    setMute(m) {
        this.audio.setMute(m);
    }

    start() {
        this.state = 'running';
        this.ui.menu.classList.add('hidden');
        this.ui.pause.classList.add('hidden');
        this.ui.gameover.classList.add('hidden');
        this.ui.hud.classList.remove('hidden');
        this.ui.reticle.style.display = 'block';

        this.resetProgress();
        this.spawner.reset();
        this.player.reset();
        this.tunnel.reset();

        this.applyDebug();
        this.input.requestPointerLock();
    }

    restart() {
        this.start();
    }

    resume() {
        if (this.state !== 'paused') return;
        this.state = 'running';
        this.ui.pause.classList.add('hidden');
        this.ui.hud.classList.remove('hidden');
        this.applyDebug();
        this.input.requestPointerLock();
    }

    toMenu() {
        this.state = 'menu';
        this.ui.menu.classList.remove('hidden');
        this.ui.pause.classList.add('hidden');
        this.ui.gameover.classList.add('hidden');
        this.ui.hud.classList.add('hidden');
        this.ui.reticle.style.display = 'none';
        this.input.exitPointerLock();
    }

    togglePause() {
        if (this.state === 'running') {
            this.state = 'paused';
            this.ui.pause.classList.remove('hidden');
            this.ui.hud.classList.add('hidden');
            this.input.exitPointerLock();
        } else if (this.state === 'paused') {
            this.resume();
        }
    }

    gameOver() {
        this.state = 'gameover';
        this.ui.hud.classList.add('hidden');
        this.ui.gameover.classList.remove('hidden');
        this.ui.finalScore.textContent = Math.floor(this.score).toString();
        if (this.score > this.bestScore) {
            this.bestScore = Math.floor(this.score);
            localStorage.setItem('bestScore', String(this.bestScore));
        }
        this.ui.bestScore.textContent = String(this.bestScore);
        this.audio.playCrash();
        this.input.exitPointerLock();
    }

    onSceneResized() {}

    loop(now) {
        const dt = Math.min((now - this.lastTime) / 1000, 1 / 20);
        this.lastTime = now;

        if (this.state === 'running') {
            this.update(dt);
            this.render();
        } else {
            this.render();
        }

        requestAnimationFrame(this.loop);
    }

    update(dt) {
        this.worldSpeed += this.speedUpPerSec * dt;
        this.distanceTravelled += this.worldSpeed * dt;
        this.score += (this.worldSpeed * dt) / 2;

        this.hud.update({
            score: Math.floor(this.score),
            speed: Math.floor(this.worldSpeed),
            coins: this.coins,
        });

        if (this.input.isLocked()) {
            const d = this.input.consumeDelta();
            this.player.updateRelative(d, dt);
        } else {
            const target = this.input.getTarget();
            this.player.updateAbsolute(target, dt);
        }

        this.tunnel.update(this.worldSpeed, dt);
        this.spawner.update(this.worldSpeed, dt);

        const hit = this.collision.checkObstacles(
            this.spawner.obstacles,
            this.player
        );
        if (hit) {
            this.gameOver();
            return;
        }

        const got = this.collision.collectCoins(
            this.spawner.coins,
            this.player
        );
        if (got > 0) {
            this.coins += got;
            this.score += got * 25;
            this.audio.playCoin();
        }

        // No need to touch spawner.setDifficulty here (constant spacing).
    }

    render() {
        const px = this.player.position.x;
        const py = this.player.position.y;

        this.camera.position.set(px, py, 0);
        this.camera.lookAt(px, py, -20);
        this.camera.up.set(0, 1, 0);

        this.sceneMgr.render();
    }
}
