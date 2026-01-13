// Timer Module
const Timer = {
    STORAGE_KEY: 'gameocr_timer',
    button: null,
    display: null,
    isRunning: false,
    elapsedSeconds: 0,
    startTime: null,
    intervalId: null,
    lastLineAddedTime: null,
    AFK_TIMEOUT: 60, // seconds

    init() {
        this.button = document.getElementById('timerButton');
        this.display = document.getElementById('timerDisplay');

        // Load saved timer state
        this.loadState();

        // Set up button click handler
        this.button.addEventListener('click', () => this.toggle());

        // Set initial button icon based on state
        if (this.isRunning) {
            // Set to pause
            this.button.innerHTML = Icons.pause;
            this.start();
        } else {
            // Set to play
            this.button.innerHTML = Icons.play;
        }

        // Initial display update
        this.updateDisplay();
    },

    loadState() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
            const state = JSON.parse(stored);
            this.elapsedSeconds = state.elapsedSeconds || 0;
            this.isRunning = state.isRunning || false;
            this.startTime = state.startTime || null;
            this.lastLineAddedTime = state.lastLineAddedTime || null;

            // If was running, calculate elapsed time since last save
            if (this.isRunning && this.startTime) {
                const now = Date.now();
                const additionalSeconds = Math.floor((now - this.startTime) / 1000);
                this.elapsedSeconds += additionalSeconds;
            }
        }
    },

    saveState() {
        const state = {
            elapsedSeconds: this.elapsedSeconds,
            isRunning: this.isRunning,
            startTime: this.startTime,
            lastLineAddedTime: this.lastLineAddedTime
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    },

    toggle() {
        if (this.isRunning) {
            this.pause();
        } else {
            this.start();
        }
    },

    start() {
        this.isRunning = true;
        this.startTime = Date.now();
        this.lastLineAddedTime = Date.now();
        this.button.innerHTML = Icons.pause;

        // Update every second
        this.intervalId = setInterval(() => {
            this.elapsedSeconds++;
            this.updateDisplay();
            this.saveState();

            // Check for AFK timeout
            this.checkAfkTimeout();
        }, 1000);

        this.saveState();
    },

    pause() {
        this.isRunning = false;
        this.startTime = null;
        this.button.innerHTML = Icons.play;

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.saveState();
    },

    reset() {
        this.pause();
        this.elapsedSeconds = 0;
        this.updateDisplay();
        this.saveState();
    },

    updateDisplay() {
        const hours = Math.floor(this.elapsedSeconds / 3600);
        const minutes = Math.floor((this.elapsedSeconds % 3600) / 60);
        const seconds = this.elapsedSeconds % 60;

        const timeFormatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // Get text statistics
        let stats = { charCount: 0, lineCount: 0 };
        if (window.TextHookDisplay) {
            stats = window.TextHookDisplay.getStats();
        }

        // Calculate characters per hour
        let charsPerHour = 0;
        if (this.elapsedSeconds > 0) {
            const hoursElapsed = this.elapsedSeconds / 3600;
            charsPerHour = Math.round(stats.charCount / hoursElapsed);
        }

        const formatted = `${timeFormatted} (${charsPerHour}/h) ${stats.charCount}/${stats.lineCount}`;
        this.display.textContent = formatted;
    },

    notifyLineAdded() {
        // Called by TextHookDisplay when a line is added
        this.lastLineAddedTime = Date.now();
        this.saveState();
    },

    checkAfkTimeout() {
        if (!this.isRunning || !this.lastLineAddedTime) {
            return;
        }

        const now = Date.now();
        const secondsSinceLastLine = Math.floor((now - this.lastLineAddedTime) / 1000);

        // If 1 minute has passed without new lines
        if (secondsSinceLastLine >= this.AFK_TIMEOUT) {
            console.log('AFK timeout: No lines added for 1 minute. Subtracting 1 minute and pausing timer.');

            // Subtract 1 minute from timer
            this.elapsedSeconds = Math.max(0, this.elapsedSeconds - this.AFK_TIMEOUT);

            // Pause the timer
            this.pause();

            // Update display
            this.updateDisplay();
        }
    }
};
