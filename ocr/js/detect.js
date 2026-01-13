/**
 * Change Detection Module
 * Monitors video stream for changes and triggers OCR when new text appears
 *
 * Pattern detection: High change (text appearing) → Low change frames (text settled) → Trigger OCR
 */

class ChangeDetector {
    constructor(options = {}) {
        // Configuration
        this.scanInterval = options.scanInterval || 80; // ms between frame checks
        this.scaleDownFactor = options.scaleDownFactor || 4; // Scale down by 1/4 for efficiency
        this.changeThreshold = options.changeThreshold || 0.015; // 5% pixels changed = "high change"
        this.lowChangeThreshold = options.lowChangeThreshold || 0.01; // 1% = "stable"
        this.stabilityFrames = options.stabilityFrames || 3; // Frames needed to confirm stability
        this.pixelDiffThreshold = options.pixelDiffThreshold || 20; // RGB diff threshold per pixel

        // State
        this.videoElement = null;
        this.cropSettings = null;
        this.onTrigger = null;
        this.intervalId = null;
        this.lastFrame = null;

        // State machine: idle → change_detected → waiting_for_stability → (trigger) → idle
        this.state = 'idle';
        this.stableFrameCount = 0;

        // Statistics (for debugging)
        this.stats = {
            lastChangePercent: 0,
            triggeredCount: 0
        };
    }

    /**
     * Start monitoring for changes
     * @param {HTMLVideoElement} videoElement - Video element to monitor
     * @param {Object} cropSettings - Crop settings {left, right, top, bottom}
     * @param {Function} onTrigger - Callback to fire when OCR should be triggered
     */
    start(videoElement, cropSettings, onTrigger) {
        this.stop(); // Clean up any existing monitoring

        this.videoElement = videoElement;
        this.cropSettings = cropSettings;
        this.onTrigger = onTrigger;
        this.state = 'idle';
        this.stableFrameCount = 0;
        this.lastFrame = null;

        console.log('ChangeDetector: Starting monitoring');
        this.intervalId = setInterval(() => this.checkFrame(), this.scanInterval);
    }

    /**
     * Stop monitoring
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('ChangeDetector: Stopped monitoring');
        }
        this.state = 'idle';
        this.lastFrame = null;
    }

    /**
     * Check current frame for changes
     */
    checkFrame() {
        if (!this.videoElement || !this.cropSettings) {
            return;
        }

        // Don't process frames if timer is paused
        if (window.Timer && !window.Timer.isRunning) {
            return;
        }

        try {
            // Capture current frame (scaled down)
            const currentFrame = this.captureScaledFrame();

            if (!this.lastFrame) {
                this.lastFrame = currentFrame;
                return;
            }

            // Calculate pixel difference percentage
            const changePercent = this.compareFrames(this.lastFrame, currentFrame);
            this.stats.lastChangePercent = changePercent;

            // State machine logic
            this.processStateChange(changePercent);

            this.lastFrame = currentFrame;

        } catch (error) {
            console.warn('ChangeDetector: Error checking frame:', error);
        }
    }

    /**
     * Process state changes based on change percentage
     * @param {number} changePercent - Percentage of pixels that changed (0-1)
     */
    processStateChange(changePercent) {
        if (this.state === 'idle') {
            // Waiting for significant change
            if (changePercent > this.changeThreshold) {
                console.log(`ChangeDetector: High change detected (${(changePercent * 100).toFixed(2)}%)`);
                this.state = 'change_detected';
                this.stableFrameCount = 0;
            }

        } else if (this.state === 'change_detected') {
            // Change detected, waiting for first stable frame
            if (changePercent < this.lowChangeThreshold) {
                console.log(`ChangeDetector: Change settled, waiting for stability...`);
                this.state = 'waiting_for_stability';
                this.stableFrameCount = 1;
            }

        } else if (this.state === 'waiting_for_stability') {
            // Counting stable frames
            if (changePercent < this.lowChangeThreshold) {
                this.stableFrameCount++;

                if (this.stableFrameCount >= this.stabilityFrames) {
                    // Pattern complete! Trigger OCR
                    console.log(`ChangeDetector: Stability confirmed (${this.stableFrameCount} frames), triggering OCR`);
                    this.stats.triggeredCount++;

                    if (this.onTrigger) {
                        this.onTrigger();
                    }

                    this.state = 'idle';
                    this.stableFrameCount = 0;
                }

            } else if (changePercent > this.changeThreshold) {
                // Another big change detected, reset to change_detected
                console.log(`ChangeDetector: More changes detected, resetting stability counter`);
                this.state = 'change_detected';
                this.stableFrameCount = 0;

            } else {
                // Medium change - reset stability counter but stay in waiting state
                this.stableFrameCount = 0;
            }
        }
    }

    /**
     * Capture and scale down current video frame
     * @returns {ImageData} Scaled frame data
     */
    captureScaledFrame() {
        // Calculate cropped dimensions
        const cropWidth = this.videoElement.videoWidth - this.cropSettings.left - this.cropSettings.right;
        const cropHeight = this.videoElement.videoHeight - this.cropSettings.top - this.cropSettings.bottom;

        // Calculate scaled dimensions
        const scaledWidth = Math.floor(cropWidth / this.scaleDownFactor);
        const scaledHeight = Math.floor(cropHeight / this.scaleDownFactor);

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = scaledWidth;
        canvas.height = scaledHeight;
        const ctx = canvas.getContext('2d');

        // Draw cropped and scaled frame
        ctx.drawImage(
            this.videoElement,
            this.cropSettings.left,
            this.cropSettings.top,
            cropWidth,
            cropHeight,
            0,
            0,
            scaledWidth,
            scaledHeight
        );

        return ctx.getImageData(0, 0, scaledWidth, scaledHeight);
    }

    /**
     * Compare two frames and calculate change percentage
     * @param {ImageData} frame1 - First frame
     * @param {ImageData} frame2 - Second frame
     * @returns {number} Percentage of pixels that changed (0-1)
     */
    compareFrames(frame1, frame2) {
        const data1 = frame1.data;
        const data2 = frame2.data;
        let diffCount = 0;

        // Compare RGB values (skip alpha channel)
        for (let i = 0; i < data1.length; i += 4) {
            const rDiff = Math.abs(data1[i] - data2[i]);
            const gDiff = Math.abs(data1[i + 1] - data2[i + 1]);
            const bDiff = Math.abs(data1[i + 2] - data2[i + 2]);
            const totalDiff = rDiff + gDiff + bDiff;

            if (totalDiff > this.pixelDiffThreshold) {
                diffCount++;
            }
        }

        const totalPixels = data1.length / 4;
        return diffCount / totalPixels;
    }

    /**
     * Check if detector is running
     * @returns {boolean}
     */
    isRunning() {
        return this.intervalId !== null;
    }

    /**
     * Get current state and statistics
     * @returns {Object}
     */
    getStatus() {
        return {
            running: this.isRunning(),
            state: this.state,
            stableFrameCount: this.stableFrameCount,
            lastChangePercent: (this.stats.lastChangePercent * 100).toFixed(2) + '%',
            triggeredCount: this.stats.triggeredCount
        };
    }
}
