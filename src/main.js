import { Game } from './core/Game.js';

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

const game = new Game(ui);

// Expose for toggling debug in console: game.debug = true/false
window.game = game;

// Wire UI events
ui.play.addEventListener('click', () => {
    game.setSensitivity(parseFloat(ui.sensitivity.value));
    game.setInvertY(ui.invertY.checked);
    game.setMute(ui.mute.checked);
    game.start();
});

ui.resume.addEventListener('click', () => game.resume());
ui.restart.addEventListener('click', () => game.restart());
ui.toMenu.addEventListener('click', () => game.toMenu());
ui.retry.addEventListener('click', () => game.restart());
ui.menuBtn.addEventListener('click', () => game.toMenu());

ui.sensitivity.addEventListener('input', (e) => {
    game.setSensitivity(parseFloat(e.target.value));
});
ui.invertY.addEventListener('change', (e) => {
    game.setInvertY(e.target.checked);
});
ui.mute.addEventListener('change', (e) => {
    game.setMute(e.target.checked);
});

// Keyboard pause
window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
        game.togglePause();
    }
});
