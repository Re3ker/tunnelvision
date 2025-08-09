/** Minimal HUD updater for score/speed/coins. */
export class HUD {
    constructor(ui) {
        this.ui = ui;
    }

    update({ score, speed, coins }) {
        this.ui.score.textContent = String(score);
        this.ui.speed.textContent = String(speed);
        this.ui.coins.textContent = String(coins);
    }
}
