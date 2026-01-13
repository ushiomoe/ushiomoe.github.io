// Text Hook Display Module
const TextHookDisplay = {
    STORAGE_KEY: 'gameocr_text_lines',
    container: null,

    init() {
        this.container = document.getElementById('textHookDisplay');
        this.loadAndRender();
    },

    // Get all text lines from localStorage
    getLines() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    },

    // Save text lines to localStorage
    saveLines(lines) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(lines));
    },

    // Add a new line
    addLine(text) {
        // Check if timer is running
        if (window.Timer && !window.Timer.isRunning) {
            this.flashBackground();
            return;
        }

        const lines = this.getLines();
        lines.push(text);
        this.saveLines(lines);
        this.renderLine(text, true);
        this.scrollToBottom();

        // Update timer display and notify line added
        if (window.Timer) {
            window.Timer.updateDisplay();
            window.Timer.notifyLineAdded();
        }
    },

    // Flash background when trying to add line with timer stopped
    flashBackground() {
        const body = document.body;
        const settings = window.Settings ? window.Settings.getSettings() : null;

        if (!settings) return;

        const originalBg = settings.backgroundColor;
        const borderColor = window.Settings.getTintedBorderColor(settings.backgroundColor);

        // Add transition
        body.style.transition = 'background-color 0.25s ease-in-out';

        // Flash to border color
        body.style.backgroundColor = borderColor;

        // Flash back to original after 250ms
        setTimeout(() => {
            body.style.backgroundColor = originalBg;

            // Remove transition after animation completes
            setTimeout(() => {
                body.style.transition = '';
            }, 250);
        }, 250);
    },

    // Remove a line by index
    removeLine(index) {
        const lines = this.getLines();
        lines.splice(index, 1);
        this.saveLines(lines);
        this.loadAndRender();

        // Update timer display if available
        if (window.Timer) {
            window.Timer.updateDisplay();
        }
    },

    // Delete the most recent line
    deleteLastLine() {
        const lines = this.getLines();
        if (lines.length > 0) {
            lines.pop();
            this.saveLines(lines);
            this.loadAndRender();

            // Update timer display if available
            if (window.Timer) {
                window.Timer.updateDisplay();
            }
        }
    },

    // Clear all lines
    clearAll() {
        this.saveLines([]);
        this.container.innerHTML = '';

        // Update timer display if available
        if (window.Timer) {
            window.Timer.updateDisplay();
        }
    },

    // Render a single line to the DOM
    renderLine(text, animate = false) {
        const lineDiv = document.createElement('div');
        lineDiv.className = animate ? 'text-line text-line-new' : 'text-line';
        lineDiv.textContent = text;
        lineDiv.contentEditable = true;

        // Apply current line spacing setting and border color
        if (window.Settings) {
            const settings = Settings.getSettings();
            lineDiv.style.marginBottom = `${settings.lineSpacing}em`;
            lineDiv.style.borderColor = 'transparent';
        }

        // Save changes when line loses focus
        lineDiv.addEventListener('blur', () => {
            this.saveLineEdit(lineDiv);
        });

        // Prevent line breaks when pressing Enter
        lineDiv.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                lineDiv.blur(); // Unfocus to save
            }
        });

        this.container.appendChild(lineDiv);
    },

    // Save edited line to localStorage
    saveLineEdit(lineDiv) {
        const lines = this.getLines();
        const lineIndex = Array.from(this.container.children).indexOf(lineDiv);

        if (lineIndex >= 0 && lineIndex < lines.length) {
            const newText = lineDiv.textContent.trim();

            // Only save if text actually changed
            if (newText !== lines[lineIndex]) {
                lines[lineIndex] = newText;
                this.saveLines(lines);
                console.log(`Line ${lineIndex} edited and saved`);

                // Update timer display to reflect new character count
                if (window.Timer) {
                    window.Timer.updateDisplay();
                }
            }
        }
    },

    // Load all lines from localStorage and render them
    loadAndRender() {
        this.container.innerHTML = '';
        const lines = this.getLines();
        lines.forEach(line => this.renderLine(line));
        this.scrollToBottom();
    },

    // Auto-scroll to the bottom of the page
    scrollToBottom() {
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
        });
    },

    // Get statistics about the text
    getStats() {
        const NOT_JAPANESE_REGEX = /[^0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}]+/gimu;

        const lines = this.getLines();
        const totalChars = lines.reduce((sum, line) => {
            const filteredText = line.replace(NOT_JAPANESE_REGEX, '');
            return sum + filteredText.length;
        }, 0);

        return {
            lineCount: lines.length,
            charCount: totalChars
        };
    }
};
