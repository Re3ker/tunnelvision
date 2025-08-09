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

/**
 * Main game orchestrator: constructs scene, player, tunnel, spawner, HUD,
 * input and audio systems; owns the main loop and game state transitions.
 */
export class Game {
    constructor(ui) {
        this.ui = ui;
        this.sceneMgr = new SceneManager();
        this.input = new Input(this.sceneMgr.renderer.domElement);
        this.audio = new AudioSystem();
        this.hud = new HUD(ui);
        // User volume settings (defaults)
        this.musicVolume = 0.3;
        this.sfxVolume = 0.3;

        this.scene = this.sceneMgr.scene;
        this.camera = this.sceneMgr.camera;

        // Static radial gradient background (inner gray -> outer black)
        this._bgTexture = null;
        this._applyBackgroundGradient();
        if (this.scene.fog) this.scene.fog.color.set(0x000000);

        // Shared rainbow color cycle (used by tunnel rings and barrier colors)
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

        // Removed the separate bars visualizer; tunnel rings will react to music instead

        this.player = new Player({
            radius: 8,
            margin: 1.2,
        });
        this.scene.add(this.player.debugMesh);

        this.spawner = new Spawner({
            tunnelRadius: 8,
            startZ: -100,
            despawnZ: 6,
            colorCycle: this.color,
        });
        this.scene.add(this.spawner.group);

        // Load SFX (and optionally music tracks you add)

        this._lastTrack = null;
        this.audioReady = this.audio
            .loadManifest({
                woosh: 'assets/audio/woosh.wav',
                coin: 'assets/audio/coin.wav',
                crash: 'assets/audio/crash.wav',
                // Music tracks (playlist)
                joyride: 'assets/audio/tracks/joyride.wav',
                rubberband: 'assets/audio/tracks/rubberband.wav',
                stingray: 'assets/audio/tracks/stingray.wav',
                distance: 'assets/audio/tracks/distance.wav',
                chaos: 'assets/audio/tracks/chaos.wav',
                retro: 'assets/audio/tracks/retro.wav',
                wego: 'assets/audio/tracks/wego.wav',
                // Optional legacy track
            })
            .catch(() => {});

        this.musicPlaylist = [
            'joyride',
            'rubberband',
            'stingray',
            'distance',
            'chaos',
            'retro',
            'wego',
        ];

        // Woosh SFX when a barrier passes the player
        this.spawner.setOnBarrierPass(() => {
            this.audio.playWoosh(this.worldSpeed);
        });

        // Configure a slightly forgiving collision window to keep it fun
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

        // FSM: 'menu' | 'running' | 'paused' | 'gameover'
        this.state = 'menu';
        this.resetProgress();

        this.lastTime = performance.now();

        this.sceneMgr.onResize(this.onSceneResized.bind(this));
        this.sceneMgr.resize();

        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);

        this.toMenu();
    }

    /** Toggle debug visibility on player collider and spawner visuals. */
    applyDebug() {
        this.player.debugMesh.visible = this._debug;
        this.spawner.setDebug(this._debug);
    }

    /** Reset score/speed/counters and persistent best score. */
    resetProgress() {
        this.worldSpeed = 42;
        this.speedUpPerSec = 1;
        this.score = 0;
        this.coins = 0;
        this.bestScore =
            parseInt(localStorage.getItem('bestScore') || '0', 10) || 0;
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

    // Volume controls wired from UI
    setMusicVolume(v) {
        const vol = Math.max(0, Math.min(1, v));
        this.musicVolume = vol;
        this.audio.setBusVolume('music', vol);
    }
    setSfxVolume(v) {
        const vol = Math.max(0, Math.min(1, v));
        this.sfxVolume = vol;
        this.audio.setBusVolume('sfx', vol);
    }

    /** Enter gameplay from menu, reset world and start music. */
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

        this.audioReady.then(() => {
            // Apply current UI volumes to buses
            this.audio.setBusVolume('music', this.musicVolume);
            this.audio.setBusVolume('sfx', this.sfxVolume);
            const track = this._pickRandomTrack();
            if (track) {
                this.audio.playMusic(track, {
                    loop: true,
                    fadeIn: 0.6,
                });
            }
        });
    }

    restart() {
        this.start();
    }

    /** Resume from paused state and re-lock pointer. */
    resume() {
        if (this.state !== 'paused') return;
        this.state = 'running';
        this.ui.pause.classList.add('hidden');
        this.ui.hud.classList.remove('hidden');
        this.applyDebug();
        this.input.requestPointerLock();
        this.audio.resumeMusic();
    }

    /** Return to main menu and stop music. */
    toMenu() {
        this.state = 'menu';
        this.ui.menu.classList.remove('hidden');
        this.ui.pause.classList.add('hidden');
        this.ui.gameover.classList.add('hidden');
        this.ui.hud.classList.add('hidden');
        this.ui.reticle.style.display = 'none';
        this.input.exitPointerLock();
        this.audio.stopMusic(0.3);
    }

    /** Toggle between running and paused. */
    togglePause() {
        if (this.state === 'running') {
            this.state = 'paused';
            this.ui.pause.classList.remove('hidden');
            this.ui.hud.classList.add('hidden');
            this.input.exitPointerLock();
            this.audio.pauseMusic(0.2);
        } else if (this.state === 'paused') {
            this.resume();
        }
    }

    /** Pick a random music track name from the playlist, avoiding the last track if possible. */
    _pickRandomTrack() {
        if (
            !Array.isArray(this.musicPlaylist) ||
            this.musicPlaylist.length === 0
        )
            return null;
        if (this.musicPlaylist.length === 1) return this.musicPlaylist[0];
        // Filter out last track to avoid immediate repeats
        const candidates = this.musicPlaylist.filter(
            (t) => t !== this._lastTrack
        );
        const choice =
            candidates[Math.floor(Math.random() * candidates.length)];
        this._lastTrack = choice;
        return choice;
    }

    /** Enter gameover screen, persist best score, and play crash SFX. */
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
        this.audio.pauseMusic(0.2);
    }

    onSceneResized() {
        this._applyBackgroundGradient();
    }

    // Build a radial gradient texture and set as scene background
    _applyBackgroundGradient() {
        const size = new THREE.Vector2();
        this.sceneMgr.renderer.getSize(size);
        const w = Math.max(1, Math.floor(size.x));
        const h = Math.max(1, Math.floor(size.y));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.sqrt(cx * cx + cy * cy);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, '#222222'); // inner gray
        grad.addColorStop(1, '#000000'); // outer black
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        const tex = new THREE.CanvasTexture(canvas);
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        this._bgTexture = tex;
        this.scene.background = tex;
    }

    loop(now) {
        const deltaSeconds = Math.min((now - this.lastTime) / 1000, 1 / 20);
        this.lastTime = now;

        if (this.state === 'running') {
            this.update(deltaSeconds);
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
            const deltaMove = this.input.consumeDelta();
            this.player.updateRelative(deltaMove, dt);
        } else {
            const aimTarget = this.input.getTarget();
            this.player.updateAbsolute(aimTarget, dt);
        }

        const spectrum = this.audio.getMusicFrequencyData();
        this.tunnel.update(this.worldSpeed, dt, spectrum);
        this.spawner.update(this.worldSpeed, dt);

        // Background is a static gradient; no per-frame color updates

        const collidedWithObstacle = this.collision.checkObstacles(
            this.spawner.obstacles,
            this.player
        );
        if (collidedWithObstacle) {
            this.gameOver();
            return;
        }

        const coinsCollected = this.collision.collectCoins(
            this.spawner.coins,
            this.player
        );
        if (coinsCollected > 0) {
            this.coins += coinsCollected;
            this.score += coinsCollected * 25;
            this.audio.playCoin();
        }
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
