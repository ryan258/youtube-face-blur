// content.js
(function () {
  // Constants for configuration
  const BLUR_INTENSITY = "15px";
  const DEBOUNCE_DELAY = 250;
  const SPA_NAVIGATION_DELAY = 500;
  const FACE_DETECTION_OPTIONS = { scoreThreshold: 0.5 };
  const FETCH_TIMEOUT = 15000; // 15 seconds timeout for image fetching
  const MAX_CONCURRENT_PROCESSES = 3; // Limit parallel processing
  const FACE_BLUR_PADDING = 10; // Padding around the detected face

  // State for queue management
  const processingQueue = [];
  let activeProcesses = 0;

  // IntersectionObserver for lazy loading
  let intersectionObserver;

  /**
   * Fetches an image and creates an untainted version using a Blob URL.
   * This bypasses CORS restrictions for canvas manipulation.
   *
   * SECURITY NOTE: This function uses the extension's host permissions for
   * *.ytimg.com and *.gstatic.com to fetch images. Content scripts with
   * host permissions can bypass CORS restrictions, allowing us to draw the
   * image to a canvas without tainting it, which is required for face-api.js
   * to read pixel data.
   *
   * @param {string} imageUrl - The URL of the image to fetch.
   * @returns {Promise<{image: HTMLImageElement, objectURL: string}>} A promise resolving to the image element and its object URL.
   * @throws {Error} If the fetch fails or the image cannot be loaded.
   */
  async function createUntaintedImage(imageUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const response = await fetch(imageUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch image: ${response.status} ${response.statusText}`
        );
      }
      const blob = await response.blob();
      const objectURL = URL.createObjectURL(blob);
      const img = new Image();

      return new Promise((resolve, reject) => {
        img.onload = () => {
          resolve({ image: img, objectURL: objectURL }); // Pass both image and URL
        };
        img.onerror = (err) => {
          URL.revokeObjectURL(objectURL); // Clean up on error
          reject(new Error(`Failed to load image from object URL: ${err}`));
        };
        img.src = objectURL;
      });
    } catch (fetchError) {
      clearTimeout(timeoutId); // Clear timeout if fetch fails before timeout
      throw fetchError; // Re-throw fetch errors
    }
  }
  // --- End of New Function ---

  /**
   * Processes the queue of thumbnails to be blurred.
   * Respects the MAX_CONCURRENT_PROCESSES limit.
   */
  async function processQueue() {
    if (activeProcesses >= MAX_CONCURRENT_PROCESSES || processingQueue.length === 0) {
      return;
    }

    activeProcesses++;
    const thumbnail = processingQueue.shift();

    try {
      await processSingleThumbnail(thumbnail);
    } catch (err) {
      console.error("Error processing queued thumbnail:", err);
    } finally {
      activeProcesses--;
      processQueue(); // Process next item
    }
  }

  /**
   * Adds a thumbnail to the processing queue if it hasn't been processed yet.
   *
   * @param {HTMLImageElement} thumbnail - The thumbnail image element to enqueue.
   */
  function enqueueThumbnail(thumbnail) {
    if (thumbnail.dataset.faceBlurred === "true" || thumbnail.dataset.processing === "true") return;
    thumbnail.dataset.processing = "true";
    processingQueue.push(thumbnail);
    processQueue();
  }

  /**
   * Processes a single thumbnail: detects faces and applies a blur effect.
   *
   * @param {HTMLImageElement} thumbnail - The thumbnail image element to process.
   */
  async function processSingleThumbnail(thumbnail) {
    // Double check in case it was processed while in queue
    if (thumbnail.dataset.faceBlurred === "true") {
      delete thumbnail.dataset.processing;
      return;
    }

    // Validate face-api library
    if (typeof faceapi === "undefined") {
      console.error("face-api.js is not loaded. Skipping processing.");
      delete thumbnail.dataset.processing;
      return;
    }

    // --- Add check for preview URLs ---
    const imageUrl = thumbnail.src;
    if (
      !imageUrl ||
      imageUrl.includes("/an_webp/") ||
      imageUrl.includes(".mp4") ||
      imageUrl.includes(".webm")
    ) {
      delete thumbnail.dataset.processing;
      return; // Skip processing this URL
    }
    // --- End of check ---

    let untaintedImageData = null; // To store image and objectURL
    let canvas = null;

    try {
      // Use the new function to get an untainted image
      untaintedImageData = await createUntaintedImage(imageUrl); // Use the checked imageUrl
      const { image: untaintedImage } = untaintedImageData;

      // Check for zero dimensions on the loaded untainted image
      if (
        untaintedImage.naturalWidth === 0 ||
        untaintedImage.naturalHeight === 0
      ) {
        console.warn(
          "Skipping thumbnail with zero dimensions (from untainted image):",
          imageUrl
        );
        thumbnail.dataset.faceBlurred = "true"; // Mark original thumbnail
        if (untaintedImageData && untaintedImageData.objectURL) {
          URL.revokeObjectURL(untaintedImageData.objectURL); // Clean up
        }
        delete thumbnail.dataset.processing;
        return;
      }

      canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true }); // Keep the hint

      canvas.width = untaintedImage.naturalWidth;
      canvas.height = untaintedImage.naturalHeight;

      ctx.drawImage(untaintedImage, 0, 0, canvas.width, canvas.height);

      // Proceed with face detection
      const detections = await faceapi
        .detectAllFaces(
          canvas,
          new faceapi.TinyFaceDetectorOptions(FACE_DETECTION_OPTIONS)
        )
        .withFaceLandmarks();

      if (detections.length > 0) {
        for (const detection of detections) {
          const { box } = detection.detection;
          ctx.filter = `blur(${BLUR_INTENSITY})`;
          ctx.drawImage(
            untaintedImage,
            box.x - FACE_BLUR_PADDING,
            box.y - FACE_BLUR_PADDING,
            box.width + FACE_BLUR_PADDING * 2,
            box.height + FACE_BLUR_PADDING * 2,
            box.x - FACE_BLUR_PADDING,
            box.y - FACE_BLUR_PADDING,
            box.width + FACE_BLUR_PADDING * 2,
            box.height + FACE_BLUR_PADDING * 2
          );
          ctx.filter = "none";
        }
        thumbnail.src = canvas.toDataURL(); // Update original thumbnail src
      }

      // Mark the ORIGINAL thumbnail as processed
      thumbnail.dataset.faceBlurred = "true";
    } catch (error) {
      // Check if the error is the specific fetch error we expect for previews or timeouts
      if (error.name === "AbortError") {
        console.warn("Fetch aborted (timeout):", imageUrl);
      } else if (error instanceof TypeError) {
        // Generic network/fetch error (replaces brittle string check)
        console.warn("Fetch failed (network error):", imageUrl);
      } else {
        // Log other unexpected errors more prominently
        console.error(
          "Error processing thumbnail:",
          imageUrl || "Source URL not available",
          error
        );
      }
      // Mark original thumbnail as processed even on error to avoid loops
      thumbnail.dataset.faceBlurred = "true";
    } finally {
      if (untaintedImageData && untaintedImageData.objectURL) {
        URL.revokeObjectURL(untaintedImageData.objectURL);
      }
      // Explicit canvas cleanup
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;
      }
      delete thumbnail.dataset.processing;
    }
  }

  /**
   * Loads the face-api.js models with a retry mechanism.
   *
   * @param {number} [retries=3] - Number of retry attempts.
   * @param {number} [delay=1000] - Initial delay in ms for exponential backoff.
   */
  async function loadModelsWithRetry(retries = 3, delay = 1000) {
    if (typeof faceapi === "undefined") {
      console.error("face-api.js library not found. Cannot load models.");
      return;
    }

    const modelUrl = chrome.runtime.getURL("models");

    for (let i = 0; i < retries; i++) {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
          faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
        ]);
        console.log("Face detection models loaded");

        // Initialize IntersectionObserver
        setupIntersectionObserver();

        processYouTubeThumbnails();
        setupMutationObserver();
        setupNavigationListeners();
        return; // Success
      } catch (error) {
        console.warn(`Failed to load models (attempt ${i + 1}/${retries}):`, error);
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i))); // Exponential backoff
        }
      }
    }
    console.error("Failed to load face detection models after multiple attempts.");
  }

  /**
   * Sets up the IntersectionObserver to lazy load thumbnails.
   */
  function setupIntersectionObserver() {
    intersectionObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const thumbnail = entry.target;
          observer.unobserve(thumbnail);
          enqueueThumbnail(thumbnail);
        }
      });
    }, {
      rootMargin: "200px 0px", // Start processing before it enters viewport
      threshold: 0.01
    });
  }

  /**
   * Scans the document for YouTube thumbnails and observes them.
   */
  function processYouTubeThumbnails() {
    const thumbnails = document.querySelectorAll(
      [
        "img.yt-core-image",
        "ytd-thumbnail img",
        "ytd-rich-grid-media img.yt-img-shadow",
        "ytd-compact-video-renderer img",
        "ytd-grid-video-renderer img",
        "ytd-reel-item-renderer img",
      ].join(", ")
    );

    for (const thumbnail of thumbnails) {
      if (thumbnail.dataset.faceBlurred || thumbnail.dataset.processing || thumbnail.dataset.observed) {
        continue;
      }

      if (!thumbnail.complete || !thumbnail.naturalWidth || !thumbnail.naturalHeight) {
        thumbnail.addEventListener(
          "load",
          () => {
            if (!thumbnail.dataset.faceBlurred && !thumbnail.dataset.observed) {
              intersectionObserver.observe(thumbnail);
              thumbnail.dataset.observed = "true";
            }
          },
          { once: true }
        );
        continue;
      }

      intersectionObserver.observe(thumbnail);
      thumbnail.dataset.observed = "true";
    }
  }

  /**
   * Creates a debounced version of a function.
   *
   * @param {Function} func - The function to debounce.
   * @param {number} wait - The delay in milliseconds.
   * @returns {Function} The debounced function.
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }

  // Create a debounced version (No changes needed here)
  const debouncedProcessThumbnails = debounce(
    processYouTubeThumbnails,
    DEBOUNCE_DELAY
  );

  /**
   * Sets up a MutationObserver to detect DOM changes (new thumbnails).
   * Optimized to target specific containers and break loops early.
   *
   * @returns {MutationObserver} The created observer.
   */
  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            // Check if node is an image or contains images
            if (
              node.nodeName === "IMG" ||
              (node.nodeType === 1 && (node.querySelector("img") || node.tagName.startsWith("YTD-")))
            ) {
              shouldProcess = true;
              break;
            }
          }
        }
        if (shouldProcess) break;
      }
      if (shouldProcess) {
        debouncedProcessThumbnails();
      }
    });

    // Target specific container if possible, otherwise fallback to body
    const targetNode = document.querySelector('ytd-app') || document.body;

    observer.observe(targetNode, {
      childList: true,
      subtree: true,
    });
    return observer;
  }

  /**
   * Sets up listeners for SPA navigation events.
   */
  function setupNavigationListeners() {
    // YouTube specific event
    window.addEventListener('yt-navigate-finish', () => {
      setTimeout(debouncedProcessThumbnails, SPA_NAVIGATION_DELAY);
    });

    // Standard navigation events
    window.addEventListener('popstate', () => {
      setTimeout(debouncedProcessThumbnails, SPA_NAVIGATION_DELAY);
    });
  }

  // Start loading models (No changes needed here)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => loadModelsWithRetry());
  } else {
    loadModelsWithRetry();
  }
})(); // End of IIFE
