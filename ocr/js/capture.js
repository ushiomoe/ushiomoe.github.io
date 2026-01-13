/**
 * Window Capture Module
 * Provides functionality for selecting a window, cropping screenshots with user adjustment,
 * and handling window size changes with re-prompting
 */

class WindowCapture {
    constructor() {
        // State
        this.captureStream = null;
        this.captureVideo = null;
        this.lastWindowDimensions = null;

        // Crop settings
        this.cropSettings = {
            top: 32,
            bottom: 8,
            left: 8,
            right: 8
        };

        // LocalStorage key for persisting crop settings
        this.storageKey = 'gameOcrCropSettings';

        // Load saved crop settings
        this.loadCropSettings();
    }

    /**
     * Load crop settings from localStorage
     */
    loadCropSettings() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                const savedSettings = JSON.parse(saved);
                this.cropSettings = { ...this.cropSettings, ...savedSettings };
            }
        } catch (e) {
            console.warn('Failed to load saved crop settings:', e);
        }
    }

    /**
     * Save crop settings to localStorage
     */
    saveCropSettings() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.cropSettings));
        } catch (e) {
            console.warn('Failed to save crop settings:', e);
        }
    }

    /**
     * Initialize capture stream - prompts user to select window and set crop settings
     * @returns {Promise<void>}
     */
    async initializeCaptureStream() {
        try {
            // Request screen capture - user will be prompted to select window
            this.captureStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    mediaSource: 'window'
                },
                audio: false
            });

            this.captureVideo = document.createElement('video');
            this.captureVideo.srcObject = this.captureStream;
            this.captureVideo.autoplay = true;

            await new Promise((resolve) => {
                this.captureVideo.onloadedmetadata = resolve;
            });

            // Show crop adjustment dialog
            const userCropSettings = await this.showCropAdjustmentDialog(this.captureVideo);

            // Update crop settings with user values
            this.cropSettings = { ...userCropSettings };
            this.saveCropSettings();

            // Store initial window dimensions
            this.lastWindowDimensions = {
                width: this.captureVideo.videoWidth,
                height: this.captureVideo.videoHeight
            };

            // Handle stream ending
            this.captureStream.getTracks()[0].addEventListener('ended', () => {
                this.cleanup();
            });

        } catch (error) {
            throw new Error('Screenshot capture cancelled or failed: ' + error.message);
        }
    }

    /**
     * Show crop adjustment dialog with live preview
     * @param {HTMLVideoElement} video - The video element to preview
     * @returns {Promise<Object>} Resolves with crop settings {left, right, top, bottom}
     */
    async showCropAdjustmentDialog(video) {
        return new Promise(async (resolve) => {
            // Get current settings for styling
            let settings = { accentColor: '#2b2b2b', foregroundColor: '#ffffff', backgroundColor: '#000000' };
            let borderColor = '#555';
            let controlBackgroundColor = '#444';

            if (window.Settings) {
                settings = window.Settings.getSettings();
                borderColor = window.Settings.getTintedBorderColor(settings.backgroundColor);
                controlBackgroundColor = window.Settings.getTintedBorderColor(settings.accentColor);
            }

            // Capture current frame for preview
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = video.videoWidth;
            sourceCanvas.height = video.videoHeight;
            const sourceCtx = sourceCanvas.getContext('2d');
            sourceCtx.drawImage(video, 0, 0);

            // Create preview canvas for cropped result
            const previewCanvas = document.createElement('canvas');
            const previewCtx = previewCanvas.getContext('2d');

            // Create modal overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.9);
                z-index: 999999;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 20px;
                box-sizing: border-box;
            `;

            // Create container
            const container = document.createElement('div');
            container.style.cssText = `
                background: ${settings.accentColor};
                border: 1px solid ${borderColor};
                border-radius: 12px;
                padding: 20px;
                max-width: 90vw;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                gap: 15px;
                box-sizing: border-box;
                overflow: hidden;
            `;

            // Title
            const title = document.createElement('h2');
            title.textContent = 'Adjust OCR Scan Area';
            title.style.cssText = `
                margin: 0;
                color: ${settings.foregroundColor};
                font-family: Arial, sans-serif;
                font-size: 20px;
                text-align: center;
                flex-shrink: 0;
            `;

            // Preview container with canvas
            const previewContainer = document.createElement('div');
            previewContainer.style.cssText = `
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                flex: 1;
                min-height: 0;
                overflow: hidden;
            `;

            // Style the preview canvas
            previewCanvas.style.cssText = `
                display: block;
                max-width: 100%;
                max-height: 100%;
                width: auto;
                height: auto;
                object-fit: contain;
                border: 1px solid ${borderColor};
            `;

            // Controls container
            const controlsContainer = document.createElement('div');
            controlsContainer.style.cssText = `
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
                color: ${settings.foregroundColor};
                font-family: Arial, sans-serif;
                font-size: 14px;
                flex-shrink: 0;
            `;

            // Current crop values - use saved settings
            let cropValues = {
                left: this.cropSettings.left,
                right: this.cropSettings.right,
                top: this.cropSettings.top,
                bottom: this.cropSettings.bottom
            };

            // Function to update cropped preview
            const updateCroppedPreview = () => {
                // Calculate cropped dimensions
                const croppedWidth = sourceCanvas.width - cropValues.left - cropValues.right;
                const croppedHeight = sourceCanvas.height - cropValues.top - cropValues.bottom;

                // Resize preview canvas to match cropped dimensions
                previewCanvas.width = croppedWidth;
                previewCanvas.height = croppedHeight;

                // Draw the cropped portion from source canvas
                previewCtx.drawImage(
                    sourceCanvas,
                    cropValues.left,      // Source X
                    cropValues.top,       // Source Y
                    croppedWidth,         // Source width
                    croppedHeight,        // Source height
                    0,                    // Dest X
                    0,                    // Dest Y
                    croppedWidth,         // Dest width
                    croppedHeight         // Dest height
                );
            };

            // Create slider control
            const createSlider = (label, initialValue, max, onChange) => {
                const sliderContainer = document.createElement('div');
                sliderContainer.style.cssText = `
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                `;

                const labelContainer = document.createElement('div');
                labelContainer.style.cssText = `
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                `;

                const labelElement = document.createElement('label');
                labelElement.textContent = label;
                labelElement.style.fontWeight = 'bold';

                const valueDisplay = document.createElement('span');
                valueDisplay.textContent = initialValue + 'px';
                valueDisplay.style.cssText = `
                    color: ${settings.foregroundColor};
                    font-family: monospace;
                `;

                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = '0';
                slider.max = max;
                slider.value = initialValue;
                slider.style.cssText = `
                    width: 100%;
                    cursor: pointer;
                `;

                const updateValue = (value) => {
                    value = Math.max(0, Math.min(max, value));
                    slider.value = value;
                    valueDisplay.textContent = value + 'px';
                    onChange(value);
                    updateCroppedPreview();
                };

                slider.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    valueDisplay.textContent = value + 'px';
                    onChange(value);
                    updateCroppedPreview();
                });

                // Button container
                const buttonContainer = document.createElement('div');
                buttonContainer.style.cssText = `
                    display: flex;
                    gap: 5px;
                    justify-content: center;
                `;

                // Decrement button
                const decrementButton = document.createElement('button');
                decrementButton.textContent = '−';
                decrementButton.style.cssText = `
                    padding: 6px 12px;
                    background: ${controlBackgroundColor};
                    color: ${settings.foregroundColor};
                    border: 1px solid ${borderColor};
                    border-radius: 4px;
                    font-size: 18px;
                    font-weight: bold;
                    cursor: pointer;
                    font-family: Arial, sans-serif;
                    min-width: 40px;
                `;
                decrementButton.addEventListener('mouseover', () => {
                    decrementButton.style.opacity = '0.8';
                });
                decrementButton.addEventListener('mouseout', () => {
                    decrementButton.style.opacity = '1';
                });
                decrementButton.addEventListener('click', () => {
                    updateValue(parseInt(slider.value) - 1);
                });

                // Increment button
                const incrementButton = document.createElement('button');
                incrementButton.textContent = '+';
                incrementButton.style.cssText = `
                    padding: 6px 12px;
                    background: ${controlBackgroundColor};
                    color: ${settings.foregroundColor};
                    border: 1px solid ${borderColor};
                    border-radius: 4px;
                    font-size: 18px;
                    font-weight: bold;
                    cursor: pointer;
                    font-family: Arial, sans-serif;
                    min-width: 40px;
                `;
                incrementButton.addEventListener('mouseover', () => {
                    incrementButton.style.opacity = '0.8';
                });
                incrementButton.addEventListener('mouseout', () => {
                    incrementButton.style.opacity = '1';
                });
                incrementButton.addEventListener('click', () => {
                    updateValue(parseInt(slider.value) + 1);
                });

                buttonContainer.appendChild(decrementButton);
                buttonContainer.appendChild(incrementButton);

                labelContainer.appendChild(labelElement);
                labelContainer.appendChild(valueDisplay);
                sliderContainer.appendChild(labelContainer);
                sliderContainer.appendChild(slider);
                sliderContainer.appendChild(buttonContainer);

                return sliderContainer;
            };

            // Create sliders
            const leftSlider = createSlider('Left', cropValues.left, Math.floor(video.videoWidth), (value) => {
                cropValues.left = value;
            });

            const rightSlider = createSlider('Right', cropValues.right, Math.floor(video.videoWidth), (value) => {
                cropValues.right = value;
            });

            const topSlider = createSlider('Top', cropValues.top, Math.floor(video.videoHeight), (value) => {
                cropValues.top = value;
            });

            const bottomSlider = createSlider('Bottom', cropValues.bottom, Math.floor(video.videoHeight), (value) => {
                cropValues.bottom = value;
            });

            // Add sliders to controls
            controlsContainer.appendChild(leftSlider);
            controlsContainer.appendChild(rightSlider);
            controlsContainer.appendChild(topSlider);
            controlsContainer.appendChild(bottomSlider);

            // Button container
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = `
                display: flex;
                gap: 10px;
                justify-content: center;
                flex-shrink: 0;
            `;

            // Confirm button
            const confirmButton = document.createElement('button');
            confirmButton.textContent = 'Confirm Crop Settings';
            confirmButton.style.cssText = `
                padding: 12px 24px;
                background: ${controlBackgroundColor};
                color: ${settings.foregroundColor};
                border: 1px solid ${borderColor};
                border-radius: 4px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                font-family: Arial, sans-serif;
            `;
            confirmButton.addEventListener('mouseover', () => {
                confirmButton.style.opacity = '0.8';
            });
            confirmButton.addEventListener('mouseout', () => {
                confirmButton.style.opacity = '1';
            });
            confirmButton.addEventListener('click', () => {
                overlay.remove();
                resolve(cropValues);
            });

            // Reset button
            const resetButton = document.createElement('button');
            resetButton.textContent = 'Reset to Default';
            resetButton.style.cssText = `
                padding: 12px 24px;
                background: ${controlBackgroundColor};
                color: ${settings.foregroundColor};
                border: 1px solid ${borderColor};
                border-radius: 4px;
                font-size: 16px;
                cursor: pointer;
                font-family: Arial, sans-serif;
            `;
            resetButton.addEventListener('mouseover', () => {
                resetButton.style.opacity = '0.8';
            });
            resetButton.addEventListener('mouseout', () => {
                resetButton.style.opacity = '1';
            });
            resetButton.addEventListener('click', () => {
                cropValues = { left: 8, right: 8, top: 32, bottom: 8 };
                // Update all sliders
                leftSlider.querySelector('input').value = cropValues.left;
                leftSlider.querySelector('span').textContent = cropValues.left + 'px';
                rightSlider.querySelector('input').value = cropValues.right;
                rightSlider.querySelector('span').textContent = cropValues.right + 'px';
                topSlider.querySelector('input').value = cropValues.top;
                topSlider.querySelector('span').textContent = cropValues.top + 'px';
                bottomSlider.querySelector('input').value = cropValues.bottom;
                bottomSlider.querySelector('span').textContent = cropValues.bottom + 'px';
                updateCroppedPreview();
            });

            // Assemble the dialog
            previewContainer.appendChild(previewCanvas);
            buttonContainer.appendChild(confirmButton);
            buttonContainer.appendChild(resetButton);
            container.appendChild(title);
            container.appendChild(previewContainer);
            container.appendChild(controlsContainer);
            container.appendChild(buttonContainer);
            overlay.appendChild(container);
            document.body.appendChild(overlay);

            // Initial preview update
            updateCroppedPreview();
        });
    }

    /**
     * Capture a screenshot from the current window
     * Re-prompts for crop settings if window size has changed
     * @returns {Promise<string>} Data URL of the cropped screenshot
     */
    async captureWindowScreenshot() {
        try {
            // Initialize stream on first capture
            if (!this.captureStream || !this.captureVideo) {
                await this.initializeCaptureStream();
            }

            // Check if window dimensions have changed
            const currentDimensions = {
                width: this.captureVideo.videoWidth,
                height: this.captureVideo.videoHeight
            };

            if (this.lastWindowDimensions &&
                (this.lastWindowDimensions.width !== currentDimensions.width ||
                 this.lastWindowDimensions.height !== currentDimensions.height)) {

                console.log('Window size changed, showing crop adjustment dialog');
                console.log(`Previous: ${this.lastWindowDimensions.width}x${this.lastWindowDimensions.height}, Current: ${currentDimensions.width}x${currentDimensions.height}`);

                // Show crop adjustment dialog again with new dimensions
                const userCropSettings = await this.showCropAdjustmentDialog(this.captureVideo);

                // Update crop settings with user values
                this.cropSettings = { ...userCropSettings };
                this.saveCropSettings();
            }

            // Store current dimensions for next comparison
            this.lastWindowDimensions = currentDimensions;

            // Create canvas and capture current frame
            const canvas = document.createElement('canvas');
            canvas.width = this.captureVideo.videoWidth;
            canvas.height = this.captureVideo.videoHeight;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(this.captureVideo, 0, 0);

            // Create a new canvas for the cropped version
            const croppedCanvas = document.createElement('canvas');
            const croppedWidth = canvas.width - this.cropSettings.left - this.cropSettings.right;
            const croppedHeight = canvas.height - this.cropSettings.top - this.cropSettings.bottom;

            croppedCanvas.width = croppedWidth;
            croppedCanvas.height = croppedHeight;

            const croppedCtx = croppedCanvas.getContext('2d');

            // Draw the cropped portion (removes window chrome)
            croppedCtx.drawImage(
                canvas,
                this.cropSettings.left,           // Source X
                this.cropSettings.top,            // Source Y
                croppedWidth,                     // Source width
                croppedHeight,                    // Source height
                0,                                // Dest X
                0,                                // Dest Y
                croppedWidth,                     // Dest width
                croppedHeight                     // Dest height
            );

            // Convert to PNG
            const pngDataUrl = croppedCanvas.toDataURL('image/png', 0.9);

            return pngDataUrl;

        } catch (error) {
            throw new Error('Screenshot capture cancelled or failed: ' + error.message);
        }
    }

    /**
     * Clean up resources
     */
    cleanup() {
        if (this.captureStream) {
            this.captureStream.getTracks().forEach(track => track.stop());
            this.captureStream = null;
        }
        this.captureVideo = null;
        this.lastWindowDimensions = null;
    }

    /**
     * Check if capture is currently initialized
     * @returns {boolean}
     */
    isInitialized() {
        return !!(this.captureStream && this.captureVideo);
    }
}
