import { Game } from './core/Game.js';

// Cache UI elements we need to update or listen to
const ui = {
    hud: document.getElementById('hud'),
    score: document.getElementById('score'),
    speed: document.getElementById('speed'),
    coins: document.getElementById('coins'),
    reticle: document.getElementById('reticle'),
    menu: document.getElementById('menu'),
    play: document.getElementById('play'),
    sensitivity: document.getElementById('sensitivity'),
    invertY: document.getElementById('invertY'),
    musicVol: document.getElementById('musicVol'),
    sfxVol: document.getElementById('sfxVol'),
    mute: document.getElementById('mute'),
    pause: document.getElementById('pause'),
    resume: document.getElementById('resume'),
    restart: document.getElementById('restart'),
    toMenu: document.getElementById('toMenu'),
    gameover: document.getElementById('gameover'),
    finalScore: document.getElementById('finalScore'),
    bestScore: document.getElementById('bestScore'),
    retry: document.getElementById('retry'),
    menuBtn: document.getElementById('menuBtn'),
};

// Create the game with references to the UI
const game = new Game(ui);

// Expose for toggling debug in console: game.debug = true/false
window.game = game;

// Wire UI events
const SETTINGS_KEY = 'collider:settings:v1';

const defaultSettings = {
    sensitivity: 1.0,
    invertY: false,
    musicVol: 0.3,
    sfxVol: 0.3,
    mute: false,
};

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...defaultSettings };
        const s = JSON.parse(raw);
        return {
            sensitivity: clamp(parseFloat(s.sensitivity ?? 1.0), 0.5, 2.0),
            invertY: !!s.invertY,
            musicVol: clamp(parseFloat(s.musicVol ?? 0.3), 0, 1),
            sfxVol: clamp(parseFloat(s.sfxVol ?? 0.3), 0, 1),
            mute: !!s.mute,
        };
    } catch {
        return { ...defaultSettings };
    }
}

function saveSettings(partial = {}) {
    const prev = loadSettings();
    const next = { ...prev, ...partial };
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {}
    return next;
}

function applySettingsToUI(s) {
    ui.sensitivity.value = String(clamp(s.sensitivity, 0.5, 2.0));
    ui.invertY.checked = !!s.invertY;
    ui.musicVol.value = String(clamp(s.musicVol, 0, 1));
    ui.sfxVol.value = String(clamp(s.sfxVol, 0, 1));
    ui.mute.checked = !!s.mute;
}

function applySettingsToGame(s) {
    game.setSensitivity(clamp(s.sensitivity, 0.5, 2.0));
    game.setInvertY(!!s.invertY);
    game.setMusicVolume(clamp(s.musicVol, 0, 1));
    game.setSfxVolume(clamp(s.sfxVol, 0, 1));
    game.setMute(!!s.mute);
}

// Load settings on startup
const initialSettings = loadSettings();
applySettingsToUI(initialSettings);
applySettingsToGame(initialSettings);

ui.play.addEventListener('click', () => {
    // Persist current UI values before starting
    saveSettings({
        sensitivity: parseFloat(ui.sensitivity.value),
        invertY: ui.invertY.checked,
        musicVol: parseFloat(ui.musicVol.value),
        sfxVol: parseFloat(ui.sfxVol.value),
        mute: ui.mute.checked,
    });
    // Ensure game reflects UI immediately
    applySettingsToGame({
        sensitivity: parseFloat(ui.sensitivity.value),
        invertY: ui.invertY.checked,
        musicVol: parseFloat(ui.musicVol.value),
        sfxVol: parseFloat(ui.sfxVol.value),
        mute: ui.mute.checked,
    });
    game.start();
});

ui.resume.addEventListener('click', () => game.resume());
ui.restart.addEventListener('click', () => game.restart());
ui.toMenu.addEventListener('click', () => game.toMenu());
ui.retry.addEventListener('click', () => game.restart());
ui.menuBtn.addEventListener('click', () => game.toMenu());

ui.sensitivity.addEventListener('input', (e) => {
    game.setSensitivity(parseFloat(e.target.value));
    saveSettings({ sensitivity: parseFloat(e.target.value) });
});
ui.invertY.addEventListener('change', (e) => {
    game.setInvertY(e.target.checked);
    saveSettings({ invertY: e.target.checked });
});
ui.musicVol.addEventListener('input', (e) => {
    game.setMusicVolume(parseFloat(e.target.value));
    saveSettings({ musicVol: parseFloat(e.target.value) });
});
ui.sfxVol.addEventListener('input', (e) => {
    game.setSfxVolume(parseFloat(e.target.value));
    saveSettings({ sfxVol: parseFloat(e.target.value) });
});
ui.mute.addEventListener('change', (e) => {
    game.setMute(e.target.checked);
    saveSettings({ mute: e.target.checked });
});

// Keyboard pause
window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
        game.togglePause();
    }
});
