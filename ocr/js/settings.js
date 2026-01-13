// Settings Module
const Settings = {
    STORAGE_KEY: 'gameocr_settings',
    popup: null,
    icon: null,
    defaults: {
        fontFamily: 'Noto Sans JP',
        fontSize: 16,
        lineSpacing: 0.5,
        foregroundColor: '#deddda',
            backgroundColor: '#000000',
            accentColor: '#101828',
            blurStats: false
    },

    init() {
        this.popup = document.getElementById('settingsPopup');
        this.icon = document.getElementById('settingsIcon');

        this.icon.addEventListener('click', () => this.toggle());

        // Close popup when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.popup.contains(e.target) && !this.icon.contains(e.target)) {
                this.hide();
            }
        });

        // Load settings and set up event listeners
        this.loadSettings();
        this.setupEventListeners();
        this.applySettings();
    },

    getSettings() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        const storedSettings = stored ? JSON.parse(stored) : {};
        // Merge with defaults to ensure all properties exist
        return { ...this.defaults, ...storedSettings };
    },

    saveSettings(settings) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
    },

    loadSettings() {
        const settings = this.getSettings();
        document.getElementById('fontFamily').value = settings.fontFamily;
        document.getElementById('fontSize').value = settings.fontSize;
        document.getElementById('lineSpacing').value = settings.lineSpacing;
        document.getElementById('foregroundColor').value = settings.foregroundColor;
        document.getElementById('backgroundColor').value = settings.backgroundColor;
        document.getElementById('accentColor').value = settings.accentColor;
        document.getElementById('blurStats').checked = settings.blurStats;
    },

    setupEventListeners() {
        const fontFamilySelect = document.getElementById('fontFamily');
        const fontSizeInput = document.getElementById('fontSize');
        const lineSpacingInput = document.getElementById('lineSpacing');
        const foregroundColorInput = document.getElementById('foregroundColor');
        const backgroundColorInput = document.getElementById('backgroundColor');
        const accentColorInput = document.getElementById('accentColor');
        const blurStatsCheckbox = document.getElementById('blurStats');

        fontFamilySelect.addEventListener('change', () => this.updateSetting());
        fontSizeInput.addEventListener('input', () => this.updateSetting());
        lineSpacingInput.addEventListener('input', () => this.updateSetting());
        foregroundColorInput.addEventListener('input', () => this.updateSetting());
        backgroundColorInput.addEventListener('input', () => this.updateSetting());
        accentColorInput.addEventListener('input', () => this.updateSetting());
        blurStatsCheckbox.addEventListener('change', () => this.updateSetting());
    },

    updateSetting() {
        const settings = {
            fontFamily: document.getElementById('fontFamily').value,
            fontSize: parseInt(document.getElementById('fontSize').value),
            lineSpacing: parseFloat(document.getElementById('lineSpacing').value),
            foregroundColor: document.getElementById('foregroundColor').value,
                backgroundColor: document.getElementById('backgroundColor').value,
                accentColor: document.getElementById('accentColor').value,
                blurStats: document.getElementById('blurStats').checked
        };
        this.saveSettings(settings);
        this.applySettings();
    },

    applySettings() {
        const settings = this.getSettings();
        const controlsBg = document.getElementById('controls-background');
        const display = document.getElementById('textHookDisplay');
        const body = document.body;
        const settingsPopup = this.popup;
        const deleteButton = document.getElementById('deleteLastButton');
        const settingsIcon = this.icon;
        const timerButton = document.getElementById('timerButton');
        const timerDisplay = document.getElementById('timerDisplay');

        // Calculate border color based on background
        const borderColor = this.getTintedBorderColor(settings.backgroundColor);
        // Calculate tinted control background based on accent color
        const controlBackgroundColor = this.getTintedBorderColor(settings.accentColor);

        // Apply colors to body and display
        controlsBg.style.backgroundColor = settings.backgroundColor;
        body.style.backgroundColor = settings.backgroundColor;
        body.style.color = settings.foregroundColor;
        display.style.fontFamily = `"${settings.fontFamily}", sans-serif`;
        display.style.fontSize = `${settings.fontSize}px`;
        display.style.color = settings.foregroundColor;

        // Calculate CSS filters for icon colors (from red to target color)
        const accentTintColor = this.getTintedBorderColor(settings.accentColor);

        // Apply colors to timer display
        timerDisplay.style.color = settings.foregroundColor;

        // Apply blur stats setting
        if (settings.blurStats) {
            timerDisplay.classList.add('blurred');
        } else {
            timerDisplay.classList.remove('blurred');
        }

        // Apply colors to settings popup (use accent color for popup background)
        settingsPopup.style.backgroundColor = settings.accentColor;
        settingsPopup.style.color = settings.foregroundColor;
        settingsPopup.style.borderColor = borderColor;

        // Update labels, title and inputs in settings popup
        const settingsTitle = settingsPopup.querySelector('.settings-title');
        if (settingsTitle) {
            settingsTitle.style.color = settings.foregroundColor;
        }

        const labels = settingsPopup.querySelectorAll('label');
        labels.forEach(label => {
            label.style.color = settings.foregroundColor;
        });

        const inputs = settingsPopup.querySelectorAll('select, input[type="number"], input[type="color"]');
        inputs.forEach(input => {
            input.style.backgroundColor = controlBackgroundColor;
            input.style.color = settings.foregroundColor;
            input.style.borderColor = borderColor;
        });

        // Style reset button
        const resetButton = settingsPopup.querySelector('#resetSessionButton');
        if (resetButton) {
            resetButton.style.backgroundColor = controlBackgroundColor;
            resetButton.style.color = settings.foregroundColor;
            resetButton.style.borderColor = borderColor;
        }

        // Update line spacing and colors for all text lines
        const textLines = document.querySelectorAll('.text-line');
        textLines.forEach(line => {
            line.style.marginBottom = `${settings.lineSpacing}em`;
            line.style.borderColor = 'transparent';
        });

        // Add event listeners to update border/background on focus/blur
        // Use CSS custom properties for dynamic styling
        document.documentElement.style.setProperty('--control-bg-color', controlBackgroundColor);
        document.documentElement.style.setProperty('--border-color', borderColor);
    },

    toggle() {
        this.popup.classList.toggle('visible');
    },

    show() {
        this.popup.classList.add('visible');
    },

    hide() {
        this.popup.classList.remove('visible');
    },

    // Calculate luminance of a color (0-1, where 0 is darkest)
    getLuminance(hex) {
        if (!hex) return 0.5;
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;

        // Convert to linear RGB
        const [rLinear, gLinear, bLinear] = [r, g, b].map(c => {
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });

        // Calculate relative luminance
        return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
    },

    // Adjust color brightness (amount: positive to lighten, negative to darken)
    adjustColor(hex, amount) {
        if (!hex) return '#cccccc';
        let r = parseInt(hex.slice(1, 3), 16);
        let g = parseInt(hex.slice(3, 5), 16);
        let b = parseInt(hex.slice(5, 7), 16);

        r = Math.max(0, Math.min(255, r + amount));
        g = Math.max(0, Math.min(255, g + amount));
        b = Math.max(0, Math.min(255, b + amount));

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    },

    // Get a tinted border color based on background
    getTintedBorderColor(backgroundColor) {
        const luminance = this.getLuminance(backgroundColor);

        // If background is light, darken it slightly for borders
        // If background is dark, lighten it slightly for borders
        if (luminance > 0.5) {
            return this.adjustColor(backgroundColor, -30); // Darken
        } else {
            return this.adjustColor(backgroundColor, 30); // Lighten
        }
    }
};
