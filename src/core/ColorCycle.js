import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

export class ColorCycle {
    constructor({
        hue = 0.0, // 0..1
        hueStep = 0.06, // shift applied when a ring "spawns" (wraps)
        saturation = 0.9,
        lightness = 0.55,
    } = {}) {
        this._h = ((hue % 1) + 1) % 1;
        this._step = hueStep;
        this._s = saturation;
        this._l = lightness;
        this._tmp = new THREE.Color();
    }

    get hue() {
        return this._h;
    }
    set hue(v) {
        this._h = ((v % 1) + 1) % 1;
    }

    get hueStep() {
        return this._step;
    }
    set hueStep(v) {
        this._step = Number(v);
    }

    get saturation() {
        return this._s;
    }
    set saturation(v) {
        this._s = Math.min(1, Math.max(0, v));
    }

    get lightness() {
        return this._l;
    }
    set lightness(v) {
        this._l = Math.min(1, Math.max(0, v));
    }

    // Current color as hex (no mutation)
    currentHex() {
        this._tmp.setHSL(this._h, this._s, this._l);
        return this._tmp.getHex();
    }

    // Current color as THREE.Color (no mutation)
    currentColor() {
        return new THREE.Color().setHSL(this._h, this._s, this._l);
    }

    // Sample color 'n' hue steps ahead (does not mutate state)
    sampleHex(n = 0) {
        const h = (((this._h + this._step * n) % 1) + 1) % 1;
        this._tmp.setHSL(h, this._s, this._l);
        return this._tmp.getHex();
    }

    // Advance hue by hueStep and return hex of the new hue
    advance() {
        this._h += this._step;
        this._h -= Math.floor(this._h);
        this._tmp.setHSL(this._h, this._s, this._l);
        return this._tmp.getHex();
    }
}
