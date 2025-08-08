export class AudioSystem {
    constructor() {
        this.ctx = null;
        this.muted = false;
        this._noiseBuffer = null;
    }

    lazyCtx() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
        }
        return this.ctx;
    }

    setMute(m) {
        this.muted = m;
    }

    // Reusable short noise buffer
    noiseBuffer() {
        if (this._noiseBuffer) return this._noiseBuffer;
        const ctx = this.lazyCtx();
        const dur = 0.35;
        const len = Math.ceil(dur * ctx.sampleRate);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this._noiseBuffer = buf;
        return buf;
    }

    beep({ freq = 880, dur = 0.08, type = 'sine', gain = 0.05 } = {}) {
        if (this.muted) return;
        const ctx = this.lazyCtx();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const g = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);

        g.gain.setValueAtTime(gain, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(g).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + dur + 0.02);
    }

    playCoin() {
        this.beep({ freq: 1400, dur: 0.06, type: 'triangle', gain: 0.06 });
    }

    playCrash() {
        if (this.muted) return;
        const ctx = this.lazyCtx();
        const now = ctx.currentTime;

        const bufferSize = 0.15 * ctx.sampleRate;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.2, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

        const boom = ctx.createOscillator();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(120, now);
        boom.frequency.exponentialRampToValueAtTime(40, now + 0.25);

        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.12, now);
        g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

        noise.connect(g).connect(ctx.destination);
        boom.connect(g2).connect(ctx.destination);
        noise.start(now);
        noise.stop(now + 0.2);
        boom.start(now);
        boom.stop(now + 0.3);
    }

    // New: woosh when a barrier passes the player
    playWoosh(speed = 60) {
        if (this.muted) return;
        const ctx = this.lazyCtx();
        const now = ctx.currentTime;

        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer();

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        const freq = 800 + Math.min(2200, speed * 18);
        bp.frequency.setValueAtTime(freq, now);
        bp.Q.value = 0.9;

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 200;

        const g = ctx.createGain();
        const peak = Math.min(0.18, 0.05 + speed / 250);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
        g.gain.exponentialRampToValueAtTime(peak, now + 0.02);

        src.connect(bp).connect(hp).connect(g).connect(ctx.destination);
        src.start(now);
        src.stop(now + 0.5);
    }
}
