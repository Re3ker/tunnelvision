/**
 * AudioSystem
 *
 * A tiny wrapper around the Web Audio API that provides:
 * - Master/music/SFX buses with volume/mute control
 * - One-shot SFX playback with optional filters, delay, reverb, pan, ADSR envelope
 * - Simple music playback with fade in/out and pause/resume (with position tracking)
 * - Convenience SFX helpers (coin/crash/woosh)
 *
 * All methods are safe to call before the first user gesture; the audio
 * context is created lazily on demand. Public API is stable; only local
 * variable names were expanded for readability.
 */
export class AudioSystem {
    constructor() {
        // Lazily-created AudioContext
        this.ctx = null;

        // Output buses
        this.master = null;
        this.musicGain = null;
        this.sfxGain = null;

        // Master dynamics processor (acts as a transparent limiter)
        this._limiter = null;

        // Music analysis nodes/buffers (for visuals)
        this._musicAnalyser = null;
        this._musicFreqData = null; // Uint8Array sized to analyser bins
        this._musicLevel = 0; // smoothed 0..1 for quick consumers

        // Global state
        this.muted = false;
        this.masterVolume = 0.9;

        // Loaded audio buffers (name -> AudioBuffer)
        this.buffers = new Map();
        // Shared convolver for a lightweight reverb
        this._reverb = null;
        this._reverbTime = 2.2; // seconds

        // Music playback state (set by playMusic)
        this._music = null;
    }

    /** Ensure AudioContext exists and buses are wired; return it. */
    lazyCtx() {
        if (!this.ctx) {
            const AudioContextCtor =
                window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContextCtor();

            // Buses
            this.master = this.ctx.createGain();
            this.master.gain.value = this.muted ? 0 : this.masterVolume;

            // Insert a light limiter on the master to avoid clipping when
            // multiple SFX start simultaneously.
            this._limiter = this.ctx.createDynamicsCompressor();
            // Settings approximate a fast limiter; tweak to taste.
            this._limiter.threshold.value = -3; // dB
            this._limiter.knee.value = 2; // dB
            this._limiter.ratio.value = 20; // :1
            this._limiter.attack.value = 0.003; // seconds
            this._limiter.release.value = 0.25; // seconds
            this.master.connect(this._limiter);
            this._limiter.connect(this.ctx.destination);

            this.musicGain = this.ctx.createGain();
            // Default music bus volume now comes from user settings; use 0.3 as baseline
            this.musicGain.gain.value = 0.3;
            this.musicGain.connect(this.master);

            // Tap the music bus with an analyser for visualization
            this._musicAnalyser = this.ctx.createAnalyser();
            this._musicAnalyser.fftSize = 512; // 256 bins
            this._musicAnalyser.smoothingTimeConstant = 0.7;
            this.musicGain.connect(this._musicAnalyser);

            this.sfxGain = this.ctx.createGain();
            // Default SFX bus volume comes from user settings; baseline 0.3
            this.sfxGain.gain.value = 0.3;
            this.sfxGain.connect(this.master);

            // Shared reverb
            this._reverb = this.ctx.createConvolver();
            this._reverb.buffer = this._makeImpulse(this._reverbTime);
        }
        return this.ctx;
    }

    /**
     * Mute or unmute the entire mix (master bus).
     */
    setMute(m) {
        this.muted = !!m;
        if (this.master) {
            this.master.gain.value = this.muted ? 0 : this.masterVolume;
        }
    }

    /**
     * Set the nominal master bus volume (0..1). Has no effect while muted.
     */
    setMasterVolume(v) {
        this.masterVolume = Math.max(0, Math.min(1, v));
        if (!this.muted && this.master)
            this.master.gain.value = this.masterVolume;
    }

    /**
     * Set volume on a specific bus ("music" or "sfx").
     */
    setBusVolume(bus, v) {
        const vol = Math.max(0, Math.min(1, v));
        if (bus === 'music' && this.musicGain) this.musicGain.gain.value = vol;
        if (bus === 'sfx' && this.sfxGain) this.sfxGain.gain.value = vol;
    }

    /**
     * Load a set of audio files.
     * manifest: { name: url }
     */
    async loadManifest(manifest) {
        const audioCtx = this.lazyCtx();
        const entries = Object.entries(manifest || {});
        await Promise.all(
            entries.map(async ([name, url]) => {
                try {
                    const response = await fetch(url);
                    if (!response.ok)
                        throw new Error(`HTTP ${response.status}`);
                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = await audioCtx.decodeAudioData(arrayBuffer);
                    this.buffers.set(name, buffer);
                } catch (e) {
                    console.warn(
                        `Audio load failed for "${name}" -> ${url}`,
                        e
                    );
                }
            })
        );
    }

    /** Return true if a named buffer is loaded. */
    has(name) {
        return this.buffers.has(name);
    }

    // Generic one-shot sample with effects
    play(name, opts = {}) {
        const audioCtx = this.lazyCtx();
        const startTime = audioCtx.currentTime + (opts.when || 0);
        return this.playAt(name, startTime, opts);
    }

    /**
     * Play a one-shot buffer at a given absolute time with effects.
     */
    playAt(name, when, opts = {}) {
        const audioCtx = this.lazyCtx();
        const buffer = this.buffers.get(name);
        if (!buffer) {
            console.warn(`Audio buffer not loaded: ${name}`);
            return null;
        }

        const sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = buffer;

        if (typeof opts.playbackRate === 'number') {
            sourceNode.playbackRate.value = opts.playbackRate;
        }
        if (typeof opts.detune === 'number' && 'detune' in sourceNode) {
            sourceNode.detune.value = opts.detune;
        }

        const gainNode = audioCtx.createGain();
        // Start essentially silent to avoid clicks and let limiter adapt
        gainNode.gain.value = 0.0001;

        let currentNode = sourceNode;

        if (Array.isArray(opts.filters)) {
            for (const filterCfg of opts.filters) {
                const filter = audioCtx.createBiquadFilter();
                filter.type = filterCfg.type || 'lowpass';
                if (typeof filterCfg.frequency === 'number')
                    filter.frequency.value = filterCfg.frequency;
                if (typeof filterCfg.Q === 'number')
                    filter.Q.value = filterCfg.Q;
                if (typeof filterCfg.gain === 'number')
                    filter.gain.value = filterCfg.gain;
                currentNode.connect(filter);
                currentNode = filter;
            }
        }

        if (typeof opts.pan === 'number' && audioCtx.createStereoPanner) {
            const panner = audioCtx.createStereoPanner();
            panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
            currentNode.connect(panner);
            currentNode = panner;
        }

        if (opts.delay && typeof opts.delay.time === 'number') {
            const dryGain = audioCtx.createGain();
            dryGain.gain.value = 1 - (opts.delay.mix ?? 0.25);

            const wetGain = audioCtx.createGain();
            wetGain.gain.value = opts.delay.mix ?? 0.25;

            const delayNode = audioCtx.createDelay(2.0);
            delayNode.delayTime.value = Math.min(
                2.0,
                Math.max(0, opts.delay.time)
            );

            const feedbackGain = audioCtx.createGain();
            feedbackGain.gain.value = Math.max(
                0,
                Math.min(0.95, opts.delay.feedback ?? 0.35)
            );

            currentNode.connect(dryGain).connect(gainNode);
            currentNode.connect(delayNode);
            delayNode.connect(feedbackGain).connect(delayNode);
            delayNode.connect(wetGain).connect(gainNode);
        } else {
            currentNode.connect(gainNode);
        }

        if (opts.reverb) {
            if (
                typeof opts.reverb.time === 'number' &&
                Math.abs(opts.reverb.time - this._reverbTime) > 0.01
            ) {
                this._reverbTime = Math.max(0.1, Math.min(6, opts.reverb.time));
                this._reverb.buffer = this._makeImpulse(this._reverbTime);
            }
            const wetGain = audioCtx.createGain();
            wetGain.gain.value = opts.reverb.mix ?? 0.22;
            currentNode.connect(this._reverb);
            this._reverb.connect(wetGain).connect(gainNode);
        }

        const destinationBus =
            opts.bus === 'music'
                ? this.musicGain
                : opts.bus === 'sfx'
                ? this.sfxGain
                : this.sfxGain;

        gainNode.connect(destinationBus);

        // ADSR envelope (per-call amplitude now normalized; overall volume is set by bus)
        const attack = Math.max(0, opts.envelope?.attack ?? 0.005);
        const decay = Math.max(0, opts.envelope?.decay ?? 0.01);
        const sustain = Math.max(0, Math.min(1, opts.envelope?.sustain ?? 1.0));
        const release = Math.max(0, opts.envelope?.release ?? 0.05);
        // Per-call volume options are deprecated; use bus volumes instead
        const targetLevel = 1.0;

        gainNode.gain.setValueAtTime(0.0001, when);
        gainNode.gain.linearRampToValueAtTime(targetLevel, when + attack);
        gainNode.gain.linearRampToValueAtTime(
            targetLevel * sustain,
            when + attack + decay
        );

        const startOffset = Math.max(0, opts.offset ?? 0);
        const duration =
            typeof opts.duration === 'number'
                ? Math.max(0, opts.duration)
                : buffer.duration / (sourceNode.playbackRate?.value || 1);

        // Optionally, a tiny bias could be added to when to help the limiter
        // engage before the peak. Keeping behavior unchanged here.
        sourceNode.start(when, startOffset);
        const releaseAt = when + duration;
        gainNode.gain.setValueAtTime(targetLevel * sustain, releaseAt);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, releaseAt + release);
        try {
            sourceNode.stop(releaseAt + release + 0.02);
        } catch {}

        return {
            source: sourceNode,
            stop: (at = 0) => {
                const t = audioCtx.currentTime + at;
                gainNode.gain.cancelScheduledValues(t);
                gainNode.gain.setValueAtTime(gainNode.gain.value, t);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
                try {
                    sourceNode.stop(t + 0.06);
                } catch {}
            },
        };
    }

    // Music (long/looping) playback -----------------------------

    /**
     * Start playing a (possibly looping) music buffer with optional FX.
     */
    playMusic(name, opts = {}) {
        const audioCtx = this.lazyCtx();
        const buffer = this.buffers.get(name);
        if (!buffer) {
            console.warn(`Music buffer not loaded: ${name}`);
            return null;
        }

        // Stop current music (fade)
        if (this._music) this.stopMusic(opts.fadeOut ?? 0.25);

        const sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = buffer;
        sourceNode.loop = opts.loop !== false;

        if (typeof opts.playbackRate === 'number') {
            sourceNode.playbackRate.value = opts.playbackRate;
        }
        if (typeof opts.detune === 'number' && 'detune' in sourceNode) {
            sourceNode.detune.value = opts.detune;
        }

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.0001;

        // Build chain
        let currentNode = sourceNode;

        if (Array.isArray(opts.filters)) {
            for (const filterCfg of opts.filters) {
                const filter = audioCtx.createBiquadFilter();
                filter.type = filterCfg.type || 'lowpass';
                if (typeof filterCfg.frequency === 'number')
                    filter.frequency.value = filterCfg.frequency;
                if (typeof filterCfg.Q === 'number')
                    filter.Q.value = filterCfg.Q;
                if (typeof filterCfg.gain === 'number')
                    filter.gain.value = filterCfg.gain;
                currentNode.connect(filter);
                currentNode = filter;
            }
        }

        if (typeof opts.pan === 'number' && audioCtx.createStereoPanner) {
            const panner = audioCtx.createStereoPanner();
            panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
            currentNode.connect(panner);
            currentNode = panner;
        }

        if (opts.delay && typeof opts.delay.time === 'number') {
            const dryGain = audioCtx.createGain();
            dryGain.gain.value = 1 - (opts.delay.mix ?? 0.2);

            const wetGain = audioCtx.createGain();
            wetGain.gain.value = opts.delay.mix ?? 0.2;

            const delayNode = audioCtx.createDelay(4.0);
            delayNode.delayTime.value = Math.min(
                4.0,
                Math.max(0, opts.delay.time)
            );

            const feedbackGain = audioCtx.createGain();
            feedbackGain.gain.value = Math.max(
                0,
                Math.min(0.95, opts.delay.feedback ?? 0.3)
            );

            currentNode.connect(dryGain).connect(gainNode);
            currentNode.connect(delayNode);
            delayNode.connect(feedbackGain).connect(delayNode);
            delayNode.connect(wetGain).connect(gainNode);
        } else {
            currentNode.connect(gainNode);
        }

        if (opts.reverb) {
            if (
                typeof opts.reverb.time === 'number' &&
                Math.abs(opts.reverb.time - this._reverbTime) > 0.01
            ) {
                this._reverbTime = Math.max(0.1, Math.min(6, opts.reverb.time));
                this._reverb.buffer = this._makeImpulse(this._reverbTime);
            }
            const wetGain = audioCtx.createGain();
            wetGain.gain.value = opts.reverb.mix ?? 0.2;
            currentNode.connect(this._reverb);
            this._reverb.connect(wetGain).connect(gainNode);
        }

        gainNode.connect(this.musicGain);

        const startAt = audioCtx.currentTime + (opts.when || 0);
        const fadeIn = Math.max(0, opts.fadeIn ?? 0.4);
        // Per-track volume is deprecated; use music bus volume instead
        const level = 1.0;

        gainNode.gain.setValueAtTime(0.0001, startAt);
        gainNode.gain.exponentialRampToValueAtTime(level, startAt + fadeIn);

        const offset = Math.max(0, opts.offset ?? 0);
        sourceNode.start(startAt, offset);

        this._music = {
            name,
            buffer,
            source: sourceNode,
            amp: gainNode,
            startTime: startAt,
            offset,
            loop: sourceNode.loop,
            rate: sourceNode.playbackRate.value || 1,
            // Persist opts for resume (volume is handled by bus now)
            opts: { ...opts },
            playing: true,
        };

        return this._music;
    }

    /** Fade out and stop the current music, but keep position for resume. */
    pauseMusic(fade = 0.2) {
        const m = this._music;
        if (!m || !m.source) return;
        const audioCtx = this.lazyCtx();
        const now = audioCtx.currentTime;

        const elapsed = Math.max(0, now - m.startTime);
        const progressed = elapsed * (m.rate || 1);
        m.offset = (m.offset + progressed) % m.buffer.duration;

        const fadeSeconds = Math.max(0, fade);
        m.amp.gain.cancelScheduledValues(now);
        m.amp.gain.setValueAtTime(m.amp.gain.value, now);
        m.amp.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);

        try {
            m.source.stop(now + fadeSeconds + 0.02);
        } catch {}
        m.source = null;
        m.playing = false;
    }

    /** Resume previously paused music from its stored offset. */
    resumeMusic() {
        const m = this._music;
        if (!m || m.source) return;
        this.playMusic(m.name, { ...m.opts, offset: m.offset });
    }

    /** Stop and clear music state entirely. */
    stopMusic(fade = 0.3) {
        const m = this._music;
        if (!m) return;
        this.pauseMusic(fade);
        this._music = null;
    }

    // Analysis accessors -----------------------------------------------

    /**
     * Fill and return a Uint8Array of current music frequency magnitudes (0..255).
     * Returns null if no analyser is available.
     */
    getMusicFrequencyData() {
        const analyser = this._musicAnalyser;
        if (!analyser) return null;
        const binCount = analyser.frequencyBinCount;
        if (!this._musicFreqData || this._musicFreqData.length !== binCount) {
            this._musicFreqData = new Uint8Array(binCount);
        }
        analyser.getByteFrequencyData(this._musicFreqData);
        return this._musicFreqData;
    }

    /**
     * Return a smoothed average music level in 0..1.
     */
    getMusicLevel() {
        const data = this.getMusicFrequencyData();
        if (!data) return 0;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / (data.length * 255);
        // Simple smoothing to reduce flicker
        const smoothing = 0.85;
        this._musicLevel = this._musicLevel * smoothing + avg * (1 - smoothing);
        return this._musicLevel;
    }

    // Convenience SFX ------------------------------------------------

    /** Play a short coin pickup sound. */
    playCoin() {
        return this.play('coin', {
            bus: 'sfx',
            filters: [{ type: 'highpass', frequency: 800 }],
            reverb: { mix: 0.08 },
        });
    }

    /** Play a crash sound with extra reverb for impact. */
    playCrash() {
        return this.play('crash', {
            bus: 'sfx',
            reverb: { mix: 0.35, time: 2.8 },
        });
    }

    /** Play a speed-dependent woosh as obstacles pass by the player. */
    playWoosh(speed = 60) {
        const mix = Math.min(0.3, 0.1 + speed / 400);
        const rate = Math.min(2.2, 0.8 + speed / 140);
        return this.play('woosh', {
            bus: 'sfx',
            playbackRate: rate,
            filters: [{ type: 'bandpass', frequency: 900 + speed * 8, Q: 0.9 }],
            reverb: { mix },
        });
    }

    // Impulse response for reverb
    /**
     * Create a simple exponentially-decaying stereo noise impulse for reverb.
     */
    _makeImpulse(seconds = 2.0) {
        const audioCtx = this.lazyCtx();
        const sampleRate = audioCtx.sampleRate;
        const length = Math.max(1, Math.floor(seconds * sampleRate));
        const buffer = audioCtx.createBuffer(2, length, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const t = i / length;
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.8);
            }
        }
        return buffer;
    }
}
