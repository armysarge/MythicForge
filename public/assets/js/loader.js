/**
 * @class Loader
 * @description Manages loading animation and progress transitions for a page loader.
 * @property {HTMLElement} loadingProgress - DOM element representing the loading progress bar
 * @property {HTMLElement} loadingContainer - DOM element containing the entire loading interface
 * @property {HTMLElement} menuContainer - DOM element containing the menu to be displayed after loading
 * @property {number} progress - Current progress value (0-100)
 * @method start - Initiates the three-phase loading animation sequence
 * @method animateProgress - Handles smooth progress animation between two values
 * @method complete - Finalizes the loading sequence and reveals the menu
 */
class Loader {
    constructor() {
        this.loadingProgress = document.querySelector('.loading-progress');
        this.loadingContainer = document.querySelector('.loading-container');
        this.menuContainer = document.querySelector('.menu-container');
        this.progress = 0;
    }

    start() {
        // Phase 1: Initial Load (0-30%)
        this.animateProgress(0, 30, 1000, () => {
            // Phase 2: Processing (30-70%)
            this.animateProgress(30, 70, 2000, () => {
                // Phase 3: Finalizing (70-100%)
                this.animateProgress(70, 100, 1000, () => {
                    this.complete();
                });
            });
        });
    }

    animateProgress(start, end, duration, callback) {
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min((elapsed / duration), 1);

            this.progress = start + (progress * (end - start));
            this.loadingProgress.style.width = `${this.progress}%`;

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else if (callback) {
                callback();
            }
        };

        requestAnimationFrame(animate);
    }

    complete() {
        this.loadingContainer.classList.add('loaded');
        setTimeout(() => {
            this.menuContainer.classList.add('visible');
        }, 500);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const loader = new Loader();
    loader.start();
});