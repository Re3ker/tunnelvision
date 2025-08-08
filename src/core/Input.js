export class Input {
    constructor(domElement) {
        this.dom = domElement;

        // Absolute (fallback) state
        this.center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        this.pointer = { x: this.center.x, y: this.center.y };
        this.target = { x: 0, y: 0 };

        // Relative state (pointer lock)
        this.locked = false;
        this.delta = { x: 0, y: 0 }; // accumulated per frame

        this.sensitivity = 1.0;
        // Note: default behavior is inverted when invertY is false
        this.invertY = false;

        this._onPointerMove = this._onPointerMove.bind(this);
        this._onResize = this._onResize.bind(this);
        this._onLockChange = this._onLockChange.bind(this);

        window.addEventListener('pointermove', this._onPointerMove, {
            passive: true,
        });
        window.addEventListener('resize', this._onResize);
        document.addEventListener('pointerlockchange', this._onLockChange);
    }

    _onPointerMove(e) {
        if (this.locked) {
            // Relative mode: scale deltas by sensitivity
            const sx = 0.0018 * this.sensitivity;
            const sy = 0.0018 * this.sensitivity * (this.invertY ? 1 : -1);
            this.delta.x += (e.movementX || 0) * sx;
            this.delta.y += (e.movementY || 0) * sy;

            // Prevent a single large event from exploding movement
            const clamp = (v, a) => Math.max(-a, Math.min(a, v));
            this.delta.x = clamp(this.delta.x, 1.2);
            this.delta.y = clamp(this.delta.y, 1.2);
            return;
        }

        // Absolute fallback: map screen position relative to center to [-1, 1]
        this.pointer.x = e.clientX;
        this.pointer.y = e.clientY;

        const dx = (this.pointer.x - this.center.x) / this.center.x;
        const dy = (this.pointer.y - this.center.y) / this.center.y;

        let tx = dx * this.sensitivity;
        let ty = dy * this.sensitivity * (this.invertY ? 1 : -1);

        // Clamp to unit circle
        const len = Math.hypot(tx, ty);
        if (len > 1) {
            tx /= len;
            ty /= len;
        }
        this.target.x = tx;
        this.target.y = ty;
    }

    _onResize() {
        this.center.x = window.innerWidth / 2;
        this.center.y = window.innerHeight / 2;
    }

    _onLockChange() {
        this.locked = document.pointerLockElement === this.dom;
        // Reset accumulated delta whenever lock state changes
        this.delta.x = 0;
        this.delta.y = 0;
    }

    requestPointerLock() {
        if (this.dom.requestPointerLock) this.dom.requestPointerLock();
    }

    exitPointerLock() {
        if (document.exitPointerLock) document.exitPointerLock();
    }

    isLocked() {
        return this.locked;
    }

    // Absolute mode target
    getTarget() {
        return { x: this.target.x, y: this.target.y };
    }

    // Relative mode: return and clear per-frame delta
    consumeDelta() {
        const d = { x: this.delta.x, y: this.delta.y };
        this.delta.x = 0;
        this.delta.y = 0;
        return d;
    }

    setSensitivity(s) {
        this.sensitivity = s;
    }

    setInvertY(inv) {
        this.invertY = inv;
    }
}
