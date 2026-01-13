/**
 * MeikiOCR - Japanese Text Recognition Engine
 *
 * Two-stage OCR pipeline using ONNX Runtime Web:
 * 1. Detection: Locates text regions in the image
 * 2. Recognition: Recognizes characters in each detected region
 *
 * Based on: https://github.com/rtr46/meikiocr
 */

// Module state
const MeikiOCR = (function() {
    'use strict';

    // ========================
    // CONSTANTS
    // ========================

    const MODELS = {
        DETECT: {
            URL: 'https://huggingface.co/rtr46/meiki.text.detect.v0/resolve/main/meiki.text.detect.small.v0.onnx',
            LOCAL: '/ext/meiki.text.detect.v0/meiki.text.detect.small.v0.onnx',
            INPUT_SIZE: 640
        },
        RECOGNIZE: {
            URL: 'https://huggingface.co/rtr46/meiki.txt.recognition.v0/resolve/main/meiki.text.rec.v0.960x32.onnx',
            LOCAL: '../ext/meiki.txt.recognition.v0/meiki.text.rec.v0.960x32.onnx',
            INPUT_WIDTH: 960,
            INPUT_HEIGHT: 32
        }
    };

    const THRESHOLDS = {
        DETECT_CONFIDENCE: 0.3,
        RECOGNIZE_CONFIDENCE: 0.1,
        X_OVERLAP: 0.3
    };

    const WASM_THREADS = 24;

    // ========================
    // STATE
    // ========================

    let detectSession = null;
    let recognizeSession = null;
    let initialized = false;

    // ========================
    // INITIALIZATION
    // ========================

    /**
     * Initialize the MeikiOCR models
     * @param {Object} options - Configuration options
     * @param {boolean} options.useLocal - Try to load local models first
     * @param {Function} options.onProgress - Progress callback (stage, message)
     * @returns {Promise<void>}
     */
    async function init(options = {}) {
        if (initialized) {
            return;
        }

        const { useLocal = true, onProgress = null } = options;

        // Configure ONNX Runtime
        if (typeof ort !== 'undefined') {
            ort.env.wasm.numThreads = WASM_THREADS;
        } else {
            throw new Error('ONNX Runtime Web not found. Please include ort.min.js');
        }

        try {
            // Load detection model
            if (onProgress) onProgress('detect', 'Loading detection model...');

            detectSession = await loadModel(
                useLocal ? MODELS.DETECT.LOCAL : null,
                MODELS.DETECT.URL
            );

            if (onProgress) onProgress('detect', 'Detection model loaded');

            // Load recognition model
            if (onProgress) onProgress('recognize', 'Loading recognition model...');

            recognizeSession = await loadModel(
                useLocal ? MODELS.RECOGNIZE.LOCAL : null,
                MODELS.RECOGNIZE.URL
            );

            if (onProgress) onProgress('recognize', 'Recognition model loaded');

            initialized = true;
            if (onProgress) onProgress('complete', 'MeikiOCR initialized successfully');

        } catch (error) {
            throw new Error(`Failed to initialize MeikiOCR: ${error.message}`);
        }
    }

    /**
     * Load an ONNX model, trying local first then fallback to URL
     * @param {string|null} localPath - Local path to model
     * @param {string} urlPath - URL to model
     * @returns {Promise<ort.InferenceSession>}
     */
    async function loadModel(localPath, urlPath) {
        if (localPath) {
            try {
                return await ort.InferenceSession.create(localPath);
            } catch (error) {
                console.warn(`Failed to load local model from ${localPath}, falling back to URL`);
            }
        }
        return await ort.InferenceSession.create(urlPath);
    }

    // ========================
    // DETECTION STAGE
    // ========================

    /**
     * Preprocess image for detection model
     * Resizes to fit 640x640 with padding
     * @param {string} imageDataUrl - Image as data URL
     * @returns {Promise<Object>} - Tensor data and scale info
     */
    async function preprocessForDetection(imageDataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const DETECT_SIZE = MODELS.DETECT.INPUT_SIZE;
                const origWidth = img.width;
                const origHeight = img.height;

                // Calculate scale to fit within DETECT_SIZE x DETECT_SIZE
                const scale = Math.min(DETECT_SIZE / origWidth, DETECT_SIZE / origHeight);
                const newWidth = Math.round(origWidth * scale);
                const newHeight = Math.round(origHeight * scale);

                // Resize canvas
                const resizeCanvas = document.createElement('canvas');
                resizeCanvas.width = newWidth;
                resizeCanvas.height = newHeight;
                const resizeCtx = resizeCanvas.getContext('2d');
                resizeCtx.drawImage(img, 0, 0, newWidth, newHeight);

                // Pad to DETECT_SIZE x DETECT_SIZE
                const paddedCanvas = document.createElement('canvas');
                paddedCanvas.width = DETECT_SIZE;
                paddedCanvas.height = DETECT_SIZE;
                const paddedCtx = paddedCanvas.getContext('2d');
                paddedCtx.fillStyle = 'black';
                paddedCtx.fillRect(0, 0, DETECT_SIZE, DETECT_SIZE);
                paddedCtx.drawImage(resizeCanvas, 0, 0);

                // Convert to tensor [1, 3, 640, 640] - CHW format, normalized to [0, 1]
                const imageData = paddedCtx.getImageData(0, 0, DETECT_SIZE, DETECT_SIZE);
                const data = imageData.data;
                const float32Data = new Float32Array(3 * DETECT_SIZE * DETECT_SIZE);

                for (let i = 0; i < DETECT_SIZE * DETECT_SIZE; i++) {
                    float32Data[i] = data[i * 4] / 255.0; // R
                    float32Data[DETECT_SIZE * DETECT_SIZE + i] = data[i * 4 + 1] / 255.0; // G
                    float32Data[2 * DETECT_SIZE * DETECT_SIZE + i] = data[i * 4 + 2] / 255.0; // B
                }

                resolve({
                    tensor: float32Data,
                    scale: scale,
                    origWidth: origWidth,
                    origHeight: origHeight
                });
            };
            img.src = imageDataUrl;
        });
    }

    /**
     * Check if two bounding boxes overlap
     * @param {Array} box1 - First box [x1, y1, x2, y2]
     * @param {Array} box2 - Second box [x1, y1, x2, y2]
     * @returns {boolean} - True if boxes overlap
     */
    function boxesOverlap(box1, box2) {
        const [x1_1, y1_1, x2_1, y2_1] = box1;
        const [x1_2, y1_2, x2_2, y2_2] = box2;

        // Check if boxes do NOT overlap, then negate
        const noOverlap = (x2_1 <= x1_2) || (x2_2 <= x1_1) || (y2_1 <= y1_2) || (y2_2 <= y1_1);
        return !noOverlap;
    }

    /**
     * Merge overlapping bounding boxes
     * Groups overlapping boxes and returns the merged bounding box for each group
     * @param {Array} regions - Array of {box, score} objects
     * @returns {Array} - Array of merged regions with union boxes and max scores
     */
    function mergeOverlappingBoxes(regions) {
        if (regions.length === 0) return [];

        // Create groups of overlapping boxes
        const groups = [];
        const used = new Set();

        for (let i = 0; i < regions.length; i++) {
            if (used.has(i)) continue;

            const group = [i];
            used.add(i);

            // Find all boxes that overlap with any box in this group
            let changed = true;
            while (changed) {
                changed = false;
                for (let j = 0; j < regions.length; j++) {
                    if (used.has(j)) continue;

                    // Check if box j overlaps with any box in the current group
                    for (const groupIdx of group) {
                        if (boxesOverlap(regions[j].box, regions[groupIdx].box)) {
                            group.push(j);
                            used.add(j);
                            changed = true;
                            break;
                        }
                    }
                }
            }

            groups.push(group);
        }

        // Merge each group into a single box
        const merged = [];
        for (const group of groups) {
            // Compute union box (smallest box containing all boxes in group)
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let maxScore = -Infinity;

            for (const idx of group) {
                const [x1, y1, x2, y2] = regions[idx].box;
                minX = Math.min(minX, x1);
                minY = Math.min(minY, y1);
                maxX = Math.max(maxX, x2);
                maxY = Math.max(maxY, y2);
                maxScore = Math.max(maxScore, regions[idx].score);
            }

            merged.push({
                box: [minX, minY, maxX, maxY],
                score: maxScore
            });
        }

        return merged;
    }

    /**
     * Run detection model to find text regions
     * @param {string} imageDataUrl - Image as data URL
     * @returns {Promise<Array>} - Array of detected regions with boxes and scores
     */
    async function detectTextRegions(imageDataUrl) {
        if (!detectSession) {
            throw new Error('Detection model not initialized. Call init() first.');
        }

        // Preprocess image
        const { tensor, scale, origWidth, origHeight } = await preprocessForDetection(imageDataUrl);

        // Create input tensors
        const DETECT_SIZE = MODELS.DETECT.INPUT_SIZE;
        const imagesTensor = new ort.Tensor('float32', tensor, [1, 3, DETECT_SIZE, DETECT_SIZE]);
        const origSizesTensor = new ort.Tensor('int64', [BigInt(DETECT_SIZE), BigInt(DETECT_SIZE)], [1, 2]);

        // Run inference
        const results = await detectSession.run({
            images: imagesTensor,
            orig_target_sizes: origSizesTensor
        });

        // Extract boxes and scores (handle different output name patterns)
        let boxes, scores;
        if (results.boxes && results.scores) {
            boxes = results.boxes.data;
            scores = results.scores.data;
        } else {
            // Fallback: use first two outputs
            const keys = Object.keys(results);
            boxes = results[keys[0]].data;
            scores = results[keys[1]].data;
        }

        // Filter and scale boxes back to original coordinates
        const detectedRegions = [];
        for (let i = 0; i < scores.length; i++) {
            if (scores[i] < THRESHOLDS.DETECT_CONFIDENCE) continue;

            const box = [
                Math.floor(boxes[i * 4] / scale),
                Math.floor(boxes[i * 4 + 1] / scale),
                Math.floor(boxes[i * 4 + 2] / scale),
                Math.floor(boxes[i * 4 + 3] / scale)
            ];

            // Clamp to image bounds
            box[0] = Math.max(0, Math.min(box[0], origWidth));
            box[1] = Math.max(0, Math.min(box[1], origHeight));
            box[2] = Math.max(0, Math.min(box[2], origWidth));
            box[3] = Math.max(0, Math.min(box[3], origHeight));

            detectedRegions.push({ box, score: scores[i] });
        }

        // Merge overlapping boxes
        const mergedRegions = mergeOverlappingBoxes(detectedRegions);

        // Sort by Y coordinate (top to bottom)
        mergedRegions.sort((a, b) => a.box[1] - b.box[1]);

        return mergedRegions;
    }

    // ========================
    // RECOGNITION STAGE
    // ========================

    /**
     * Crop a detected box from the original image
     * @param {HTMLCanvasElement} imageCanvas - Original image canvas
     * @param {Array} box - Bounding box [x1, y1, x2, y2]
     * @returns {HTMLCanvasElement|null} - Cropped canvas or null if invalid
     */
    function cropBox(imageCanvas, box) {
        const [x1, y1, x2, y2] = box;
        const width = x2 - x1;
        const height = y2 - y1;

        // Validate horizontal text (width > height)
        if (width <= height) return null;

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = width;
        cropCanvas.height = height;
        const ctx = cropCanvas.getContext('2d');
        ctx.drawImage(imageCanvas, x1, y1, width, height, 0, 0, width, height);

        return cropCanvas;
    }

    /**
     * Preprocess cropped box for recognition model
     * Resizes to height=32, pads to 960x32
     * @param {HTMLCanvasElement} cropCanvas - Cropped text region
     * @returns {Object} - Tensor data and metadata
     */
    function preprocessCropForRecognition(cropCanvas) {
        const INPUT_WIDTH = MODELS.RECOGNIZE.INPUT_WIDTH;
        const INPUT_HEIGHT = MODELS.RECOGNIZE.INPUT_HEIGHT;

        const origWidth = cropCanvas.width;
        const origHeight = cropCanvas.height;

        // Resize to height=32, maintain aspect ratio
        let newHeight = INPUT_HEIGHT;
        let newWidth = Math.round(origWidth * (newHeight / origHeight));

        // Scale down if too wide
        if (newWidth > INPUT_WIDTH) {
            const scale = INPUT_WIDTH / newWidth;
            newWidth = INPUT_WIDTH;
            newHeight = Math.round(newHeight * scale);
        }

        // Resize
        const resizeCanvas = document.createElement('canvas');
        resizeCanvas.width = newWidth;
        resizeCanvas.height = newHeight;
        const resizeCtx = resizeCanvas.getContext('2d');
        resizeCtx.drawImage(cropCanvas, 0, 0, newWidth, newHeight);

        // Pad to INPUT_WIDTH x INPUT_HEIGHT
        const paddedCanvas = document.createElement('canvas');
        paddedCanvas.width = INPUT_WIDTH;
        paddedCanvas.height = INPUT_HEIGHT;
        const paddedCtx = paddedCanvas.getContext('2d');
        paddedCtx.fillStyle = 'black';
        paddedCtx.fillRect(0, 0, INPUT_WIDTH, INPUT_HEIGHT);
        paddedCtx.drawImage(resizeCanvas, 0, 0);

        // Convert to tensor [1, 3, 32, 960] - CHW format, normalized
        const imageData = paddedCtx.getImageData(0, 0, INPUT_WIDTH, INPUT_HEIGHT);
        const data = imageData.data;
        const float32Data = new Float32Array(3 * INPUT_HEIGHT * INPUT_WIDTH);

        for (let i = 0; i < INPUT_WIDTH * INPUT_HEIGHT; i++) {
            float32Data[i] = data[i * 4] / 255.0; // R
            float32Data[INPUT_WIDTH * INPUT_HEIGHT + i] = data[i * 4 + 1] / 255.0; // G
            float32Data[2 * INPUT_WIDTH * INPUT_HEIGHT + i] = data[i * 4 + 2] / 255.0; // B
        }

        return {
            tensor: float32Data,
            effectiveWidth: newWidth,
            origWidth: origWidth,
            origHeight: origHeight
        };
    }

    /**
     * Decode recognition model output to text
     * @param {Array} labels - Character labels (Unicode code points)
     * @param {Array} boxes - Character bounding boxes
     * @param {Array} scores - Confidence scores
     * @param {number} effectiveWidth - Width of content area (before padding)
     * @param {number} origWidth - Original crop width
     * @param {number} origHeight - Original crop height
     * @returns {Object} - Decoded text and character details
     */
    function decodeMeikiOCROutput(labels, boxes, scores, effectiveWidth, origWidth, origHeight) {
        const INPUT_HEIGHT = MODELS.RECOGNIZE.INPUT_HEIGHT;
        let candidates = [];

        // Process each detected character
        for (let i = 0; i < labels.length; i++) {
            const score = scores[i];
            if (score < THRESHOLDS.RECOGNIZE_CONFIDENCE) continue;

            const label = labels[i];
            const char = String.fromCharCode(label);
            const box = boxes.slice(i * 4, i * 4 + 4); // [x1, y1, x2, y2]

            let [rx1, ry1, rx2, ry2] = box;

            // Clamp to effective content area
            rx1 = Math.min(rx1, effectiveWidth);
            rx2 = Math.min(rx2, effectiveWidth);

            // Map from recognition space to original crop space
            const cx1 = (rx1 / effectiveWidth) * origWidth;
            const cx2 = (rx2 / effectiveWidth) * origWidth;
            const cy1 = (ry1 / INPUT_HEIGHT) * origHeight;
            const cy2 = (ry2 / INPUT_HEIGHT) * origHeight;

            candidates.push({
                char: char,
                bbox: [Math.floor(cx1), Math.floor(cy1), Math.floor(cx2), Math.floor(cy2)],
                conf: score,
                xInterval: [cx1, cx2]
            });
        }

        // Sort by confidence (descending) for deduplication
        candidates.sort((a, b) => b.conf - a.conf);

        // Deduplicate overlapping characters
        const accepted = [];
        for (const candidate of candidates) {
            let overlaps = false;
            for (const other of accepted) {
                const [ax1, ax2] = candidate.xInterval;
                const [bx1, bx2] = other.xInterval;
                const overlap = Math.min(ax2, bx2) - Math.max(ax1, bx1);
                const minWidth = Math.min(ax2 - ax1, bx2 - bx1);
                if (overlap > minWidth * THRESHOLDS.X_OVERLAP) {
                    overlaps = true;
                    break;
                }
            }
            if (!overlaps) {
                accepted.push(candidate);
            }
        }

        // Sort by x-coordinate for reading order
        accepted.sort((a, b) => a.xInterval[0] - b.xInterval[0]);

        const text = accepted.map(c => c.char).join('');
        return { text, chars: accepted };
    }

    /**
     * Recognize text in a detected region
     * @param {HTMLCanvasElement} imageCanvas - Original image canvas
     * @param {Array} box - Bounding box [x1, y1, x2, y2]
     * @returns {Promise<string>} - Recognized text
     */
    async function recognizeTextRegion(imageCanvas, box) {
        if (!recognizeSession) {
            throw new Error('Recognition model not initialized. Call init() first.');
        }

        // Crop region
        const cropCanvas = cropBox(imageCanvas, box);
        if (!cropCanvas) return ''; // Skip invalid boxes

        // Preprocess crop
        const { tensor, effectiveWidth, origWidth, origHeight } = preprocessCropForRecognition(cropCanvas);

        // Create input tensors
        const INPUT_WIDTH = MODELS.RECOGNIZE.INPUT_WIDTH;
        const INPUT_HEIGHT = MODELS.RECOGNIZE.INPUT_HEIGHT;
        const imagesTensor = new ort.Tensor('float32', tensor, [1, 3, INPUT_HEIGHT, INPUT_WIDTH]);
        const origSizesTensor = new ort.Tensor('int64', [BigInt(INPUT_WIDTH), BigInt(INPUT_HEIGHT)], [1, 2]);

        // Run inference
        const results = await recognizeSession.run({
            images: imagesTensor,
            orig_target_sizes: origSizesTensor
        });

        // Extract labels, boxes, scores (handle different output name patterns)
        let labels, boxes, scores;
        if (results.labels && results.boxes && results.scores) {
            labels = results.labels.data;
            boxes = results.boxes.data;
            scores = results.scores.data;
        } else {
            // Fallback: use first three outputs
            const keys = Object.keys(results);
            labels = results[keys[0]].data;
            boxes = results[keys[1]].data;
            scores = results[keys[2]].data;
        }

        // Decode to text
        const { text } = decodeMeikiOCROutput(labels, boxes, scores, effectiveWidth, origWidth, origHeight);
        return text;
    }

    // ========================
    // MAIN OCR PIPELINE
    // ========================

    /**
     * Perform two-stage OCR on an image
     * @param {string} imageDataUrl - Image as data URL (data:image/png;base64,...)
     * @param {Object} options - Options
     * @param {Function} options.onProgress - Progress callback (stage, message)
     * @returns {Promise<Object>} - OCR results with text and metadata
     */
    async function recognize(imageDataUrl, options = {}) {
        const { onProgress = null } = options;

        if (!initialized) {
            throw new Error('MeikiOCR not initialized. Call init() first.');
        }

        try {
            // STAGE 1: DETECTION
            if (onProgress) onProgress('detect', 'Detecting text regions...');
            const detectedRegions = await detectTextRegions(imageDataUrl);

            if (detectedRegions.length === 0) {
                if (onProgress) onProgress('complete', 'No text detected');
                return { text: '', lines: [], regionCount: 0 };
            }

            if (onProgress) onProgress('detect', `Found ${detectedRegions.length} text region(s)`);

            // STAGE 2: RECOGNITION
            if (onProgress) onProgress('recognize', 'Recognizing text...');

            // Create canvas from original image
            const img = new Image();
            await new Promise((resolve) => {
                img.onload = resolve;
                img.src = imageDataUrl;
            });

            const imageCanvas = document.createElement('canvas');
            imageCanvas.width = img.width;
            imageCanvas.height = img.height;
            const imageCtx = imageCanvas.getContext('2d');
            imageCtx.drawImage(img, 0, 0);

            // Process each detected region
            const lines = [];
            for (let i = 0; i < detectedRegions.length; i++) {
                const { box, score } = detectedRegions[i];
                const text = await recognizeTextRegion(imageCanvas, box);

                if (text) {
                    lines.push({
                        text: text,
                        box: box,
                        confidence: score
                    });
                }

                if (onProgress) {
                    onProgress('recognize', `Processing region ${i + 1}/${detectedRegions.length}`);
                }
            }

            const finalText = lines.map(line => line.text).join('\n');

            if (onProgress) onProgress('complete', `Recognized ${lines.length} text line(s)`);

            return {
                text: finalText,
                lines: lines,
                regionCount: detectedRegions.length
            };

        } catch (error) {
            throw new Error(`OCR failed: ${error.message}`);
        }
    }

    // ========================
    // PUBLIC API
    // ========================

    return {
        /**
         * Initialize the OCR engine
         */
        init: init,

        /**
         * Perform OCR on an image
         */
        recognize: recognize,

        /**
         * Check if initialized
         */
        isInitialized: () => initialized,

        /**
         * Get version info
         */
        version: '1.0.0'
    };

})();

// Export for use as a module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MeikiOCR;
}
