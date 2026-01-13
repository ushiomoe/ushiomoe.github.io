// ==UserScript==
// @name         Anki Auto Screenshot Capture
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Automatically capture window screenshots when new Anki cards are created
// @author       You
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const ANKI_URL = "http://localhost:8765";
    const PICTURE_FIELD = "Picture";
    const POLL_INTERVAL = 1000; // Check every 1 second

    // Crop settings to remove window chrome (title bar, borders)
    const CROP_SETTINGS = {
        top: 0,      // Title bar height
        bottom: 0,    // Bottom border
        left: 0,      // Left border
        right: 0      // Right border
    };

    let currentNoteIds = new Set();
    let firstRun = true;
    let isCapturing = false;
    let captureStream = null;  // Keep the stream alive
    let captureVideo = null;   // Keep the video element

    // Start polling for new Anki cards
    startPolling();

    async function startPolling() {
        console.log('Started polling Anki for new cards...');

        while (true) {
            await checkForNewCards();
            await sleep(POLL_INTERVAL);
        }
    }

    async function checkForNewCards() {
        try {
            const updatedNoteIds = await getNoteIds();
            const newCardIds = difference(updatedNoteIds, currentNoteIds);

            if (newCardIds.size > 0 && !firstRun) {
                console.log('Detected new card in Anki! Capturing screenshot...');

                if (!isCapturing) {
                    isCapturing = true;
                    await captureAndAddToAnki();
                    isCapturing = false;
                }
            }

            firstRun = false;
            currentNoteIds = updatedNoteIds;

        } catch (error) {
            console.error('Error checking for new cards:', error);
        }
    }

    async function getNoteIds() {
        const noteIds = await ankiInvoke('findNotes', { query: 'added:1' });
        return new Set(noteIds);
    }

    function difference(setA, setB) {
        const diff = new Set();
        for (const elem of setA) {
            if (!setB.has(elem)) {
                diff.add(elem);
            }
        }
        return diff;
    }

    async function captureAndAddToAnki() {
        try {
            // Small delay to ensure card is fully created
            await sleep(500);

            // Capture the screenshot
            const webpDataUrl = await captureWindowScreenshot();

            // Get the latest Anki card
            const lastNote = await getLastAnkiCard();

            if (!lastNote || !lastNote.noteId) {
                showNotification('No Anki cards found for today', 'error');
                return;
            }

            // Check if card already has an image
            if (lastNote.fields[PICTURE_FIELD] && lastNote.fields[PICTURE_FIELD].value) {
                console.log('Latest card already has an image, skipping');
                return;
            }

            // Convert data URL to base64
            const base64Data = webpDataUrl.split(',')[1];

            // Generate filename
            const filename = `screenshot_${Date.now()}.webp`;

            // Store the image in Anki
            const storedFilename = await storeMediaFile(filename, base64Data);

            // Update the card with the image
            await updateNoteWithImage(lastNote.noteId, storedFilename);

            showNotification('✓ Screenshot added to Anki card!', 'success');
            console.log(`Updated Anki card ${lastNote.noteId} with screenshot`);

        } catch (error) {
            console.error('Error:', error);
            showNotification('Failed: ' + error.message, 'error');
        }
    }

    async function initializeCaptureStream() {
        try {
            // Request screen capture - user will be prompted ONCE to select window
            captureStream = window.WindowCapture.captureStream;
            captureVideo = document.createElement('video');
            captureVideo.srcObject = captureStream;
            captureVideo.autoplay = true;

            await new Promise((resolve) => {
                captureVideo.onloadedmetadata = resolve;
            });

            console.log('Capture stream initialized and ready');

            // Handle stream ending (e.g., user stops sharing)
            captureStream.getTracks()[0].addEventListener('ended', () => {
                console.log('Capture stream ended');
                captureStream = null;
                captureVideo = null;
            });

        } catch (error) {
            throw new Error('Screenshot capture cancelled or failed: ' + error.message);
        }
    }

    async function captureWindowScreenshot() {
        try {
            // Initialize stream on first capture
            if (!captureStream || !captureVideo) {
                await initializeCaptureStream();
            }

            // Create canvas and capture current frame
            const canvas = document.createElement('canvas');
            canvas.width = captureVideo.videoWidth;
            canvas.height = captureVideo.videoHeight;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(captureVideo, 0, 0);

            // Create a new canvas for the cropped version
            const croppedCanvas = document.createElement('canvas');
            const croppedWidth = canvas.width - CROP_SETTINGS.left - CROP_SETTINGS.right;
            const croppedHeight = canvas.height - CROP_SETTINGS.top - CROP_SETTINGS.bottom;

            croppedCanvas.width = croppedWidth;
            croppedCanvas.height = croppedHeight;

            const croppedCtx = croppedCanvas.getContext('2d');

            // Draw the cropped portion (removes window chrome)
            croppedCtx.drawImage(
                canvas,
                CROP_SETTINGS.left,           // Source X
                CROP_SETTINGS.top,            // Source Y
                croppedWidth,                 // Source width
                croppedHeight,                // Source height
                0,                            // Dest X
                0,                            // Dest Y
                croppedWidth,                 // Dest width
                croppedHeight                 // Dest height
            );

            // Convert to WebP with quality setting (0.9 = 90% quality)
            const webpDataUrl = croppedCanvas.toDataURL('image/webp', 0.9);

            return webpDataUrl;

        } catch (error) {
            throw new Error('Screenshot capture cancelled or failed: ' + error.message);
        }
    }

    async function getLastAnkiCard() {
        const noteIds = await ankiInvoke('findNotes', { query: 'added:1' });

        if (!noteIds || noteIds.length === 0) {
            return null;
        }

        const lastNoteId = noteIds[noteIds.length - 1];
        const notesInfo = await ankiInvoke('notesInfo', { notes: [lastNoteId] });

        return notesInfo[0];
    }

    async function storeMediaFile(filename, base64Data) {
        return await ankiInvoke('storeMediaFile', {
            filename: filename,
            data: base64Data
        });
    }

    async function updateNoteWithImage(noteId, filename) {
        const imageHtml = `<img src="${filename}">`;

        await ankiInvoke('updateNoteFields', {
            note: {
                id: noteId,
                fields: {
                    [PICTURE_FIELD]: imageHtml
                }
            }
        });
    }

    async function ankiInvoke(action, params = {}) {
        const payload = {
            action: action,
            version: 6,
            params: params
        };

        try {
            const response = await fetch(ANKI_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            return result.result;

        } catch (error) {
            if (error.message.includes('Failed to fetch')) {
                throw new Error('Failed to connect to Anki - make sure AnkiConnect is running');
            }
            throw error;
        }
    }

    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');

        const colors = {
            success: '#4CAF50',
            error: '#f44336',
            warning: '#ff9800',
            info: '#2196F3'
        };

        notification.textContent = message;
        notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${colors[type]};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        z-index: 10001;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: 500;
        max-width: 300px;
        animation: slideIn 0.3s ease-out;
        `;

        const style = document.createElement('style');
        style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        `;
        if (!document.querySelector('style[data-anki-notif]')) {
            style.setAttribute('data-anki-notif', 'true');
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.transition = 'opacity 0.3s ease-out';
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    console.log('Anki Auto Screenshot Capture loaded. Monitoring for new cards...');
})();
