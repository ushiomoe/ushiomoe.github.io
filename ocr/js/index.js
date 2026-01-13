// OCR Artifact Filtering
const recentLines = []; // Rolling buffer for duplicate detection
const MAX_RECENT_LINES = 10;

function filterOCRLine(text) {
    // Trim all ASCII characters from the start and end of the string
    let filtered = text.replace(/^[\x00-\x7F]+|[\x00-\x7F]+$/g, '');

    filtered = filtered.replaceAll("」」", "」");
    filtered = filtered.replaceAll("「「", "「");
    filtered = filtered.replaceAll("(", "（");
    filtered = filtered.replaceAll(")", "）");

    // Fix incomplete quotations
    let hasOpen = filtered.includes('「');
    let hasClose = filtered.includes('」');
    if (hasOpen && !hasClose) {
        filtered = filtered + '」';
    } else if (!hasOpen && hasClose) {
        filtered = '「' + filtered;
    }

    hasOpen = filtered.includes('（');
    hasClose = filtered.includes('）');
    if (hasOpen && !hasClose) {
        filtered = filtered + '）';
    } else if (!hasOpen && hasClose) {
        filtered = '（' + filtered;
    }

    // Replace common mismatches
    filtered = filtered.replaceAll("―", "ー");

    // Final validation
    filtered = filtered.trim();
    if (!filtered) {
        return null;
    }

    // Don't send the line if its the same as the previous line
    if(recentLines.at(recentLines.length) == filtered) {
        return null;
    }

    // Add to recent lines buffer
    recentLines.push(filtered);
    if (recentLines.length > MAX_RECENT_LINES) {
        recentLines.shift();
    }

    return filtered;
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Make modules globally accessible
    window.Icons = Icons;
    window.Settings = Settings;
    window.TextHookDisplay = TextHookDisplay;
    window.Timer = Timer;

    Icons.init();
    Settings.init();
    TextHookDisplay.init();
    Timer.init();

    // Initialize capture, OCR, and detection modules
    const windowCapture = new WindowCapture();
    const changeDetector = new ChangeDetector();
    let ocrInitialized = false;
    let isProcessing = false;

    window.WindowCapture = windowCapture;

    // Connection icon button - Capture and OCR
    const connectionIcon = document.getElementById('connectionIcon');

    // Function to update connection icon state
    function updateConnectionIcon(isLinked) {
        if (isLinked) {
            connectionIcon.innerHTML = Icons.link;
            connectionIcon.classList.add('linked');
        } else {
            connectionIcon.innerHTML = Icons.link_slash;
            connectionIcon.classList.remove('linked');
        }
    }

    // Shared OCR function (can be called manually or by change detector)
    async function performOCR() {
        if (isProcessing) {
            console.log('Already processing OCR, skipping...');
            return;
        }

        if (!windowCapture.isInitialized()) {
            console.log('Window capture not initialized');
            return;
        }

        try {
            isProcessing = true;

            // Capture screenshot
            const screenshotDataUrl = await windowCapture.captureWindowScreenshot();

            // Perform OCR
            const result = await MeikiOCR.recognize(screenshotDataUrl, {
                onProgress: (stage, message) => {
                    console.log(`[${stage}] ${message}`);
                }
            });

            // Add recognized text to display
            if (result.text) {
                console.log('OCR Result:', result.text);
                // Join all lines into a single string (remove line breaks)
                const singleLine = result.text.replace(/\n/g, '').trim();

                // Apply filtering chain
                const filtered = filterOCRLine(singleLine);

                if (filtered) {
                    TextHookDisplay.addLine(filtered);
                } else {
                    console.log('Line filtered out');
                }
            } else {
                console.log('No text recognized');
            }

        } catch (error) {
            console.error('Error during OCR:', error);
        } finally {
            isProcessing = false;
        }
    }

    connectionIcon.addEventListener('click', async () => {
        try {
            // Initialize OCR models on first use
            if (!ocrInitialized) {
                console.log('Initializing MeikiOCR models...');
                await MeikiOCR.init({
                    useLocal: true,
                    onProgress: (stage, message) => {
                        console.log(`[${stage}] ${message}`);
                    }
                });
                ocrInitialized = true;
                console.log('MeikiOCR initialized successfully');
            }

            // If not yet initialized, set up window capture
            if (!windowCapture.isInitialized()) {
                console.log('Initializing window capture...');
                // This will trigger the window selection and crop dialog
                await windowCapture.initializeCaptureStream();

                // Update icon to show linked state
                updateConnectionIcon(true);

                // Start automatic change detection
                console.log('Starting automatic change detection...');
                changeDetector.start(
                    windowCapture.captureVideo,
                    windowCapture.cropSettings,
                    performOCR
                );
            } else {
                // Already initialized, just perform a manual OCR
                await performOCR();
            }

        } catch (error) {
            console.error('Error during capture/OCR:', error);
            alert(`Error: ${error.message}`);
            // Reset icon to unlinked state on error
            updateConnectionIcon(false);
            windowCapture.cleanup();
            changeDetector.stop();
        }
    });

    // Delete last line button
    const deleteLastButton = document.getElementById('deleteLastButton');
    deleteLastButton.addEventListener('click', () => {
        TextHookDisplay.deleteLastLine();
    });

    // Reset session button
    const resetSessionButton = document.getElementById('resetSessionButton');
    if (resetSessionButton) {
        resetSessionButton.addEventListener('click', () => {
            const confirmed = confirm('Are you sure you want to reset your reading session? This will clear all text and reset the timer to 00:00:00.');
            if (confirmed) {
                TextHookDisplay.clearAll();
                Timer.reset();
            }
        });
    }
});
