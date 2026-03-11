// content.js
/**
 * YOUTUBE FACE BLUR - CHROME EXTENSION MASTERCLASS
 * 
 * This file demonstrates several advanced patterns for modern Chrome Extension development (Manifest V3),
 * specifically for interacting with complex, Single Page Applications (SPAs) like YouTube.
 */

// We wrap the entire extension in an Immediately Invoked Function Expression (IIFE).
// Why? Content scripts share the DOM with the host page, but they execute in an "isolated world".
// While they can't access page variables directly, using an IIFE prevents our internal variables
// from polluting the global scope of other content scripts running on the same page.
(function () {
  // --- CONFIGURATION CONSTANTS ---
  const BLUR_INTENSITY = "18px";
  const DEBOUNCE_DELAY = 200; // Limits how often DOM mutations trigger expensive rescans
  const SPA_NAVIGATION_DELAY = 400; // Yields to YouTube's internal routing before scanning new pages

  // We use tiered face detection to balance speed and accuracy. 
  // Smaller inputSize = faster but misses small faces. Larger inputSize = slower but more accurate.
  const PRIMARY_FACE_DETECTION_OPTIONS = {
    inputSize: 320,
    scoreThreshold: 0.4,
  };
  const SECONDARY_FACE_DETECTION_OPTIONS = {
    inputSize: 512,
    scoreThreshold: 0.28,
  };
  const SECONDARY_DETECTION_TRIGGER_COUNT = 1;
  const DETECTION_IOU_THRESHOLD = 0.35; // Used to prevent duplicate bounding boxes
  
  const FETCH_TIMEOUT = 15000;
  
  // CONCURRENCY CONTROL: Bounding the number of concurrent processes is critical.
  // Running AI models in the browser is CPU intensive. If we process 30 thumbnails at once,
  // the user's browser will freeze. Limiting this to 3 ensures a smooth browsing experience.
  const MAX_CONCURRENT_PROCESSES = 3;
  const FACE_BLUR_PADDING = 12; // Feathers the blur so edges don't appear blocky
  const MAX_CACHE_ENTRIES = 100; // Bounded cache prevents long-lived SPAs from running out of memory

  // YouTube's DOM is notoriously volatile. We target multiple specific image selectors 
  // ensuring we catch video thumbnails but ignore avatars, badges, and UI icons.
  const THUMBNAIL_SELECTOR = [
    "a#thumbnail img",
    "ytd-thumbnail img",
    "yt-lockup-view-model .yt-lockup-view-model__content-image img",
    "yt-thumbnail-view-model img",
    "ytd-rich-grid-media img.yt-core-image",
    "ytd-video-renderer img.yt-core-image",
    "ytd-compact-video-renderer img.yt-core-image",
    "ytd-grid-video-renderer img.yt-core-image",
    "ytd-playlist-renderer img.yt-core-image",
    "ytd-radio-renderer img.yt-core-image",
    "ytd-reel-item-renderer img.yt-core-image",
  ].join(", ");

  const STATUS = {
    BLURRED: "blurred",
    CLEAN: "clean",
    FAILED: "failed",
  };

  // --- STATE MANAGEMENT ---
  const processingQueue = [];
  const resultCache = new Map(); // Stores processed images to avoid re-running AI on scroll
  let activeProcesses = 0;
  let intersectionObserver = null;
  let mutationObserver = null;
  let modelsReady = false;

  /**
   * Utility: Debouncer
   * Ensures a function isn't called too frequently. Essential for smooth scrolling 
   * and handling rapid DOM mutations without thrashing the CPU.
   */
  function debounce(func, wait) {
    let timeoutId = 0;
    return function debounced(...args) {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => func.apply(this, args), wait);
    };
  }

  function normalizeUrl(url) {
    return typeof url === "string" ? url.trim() : "";
  }

  // YouTube often uses responsive image formats (srcset) to load higher-res images 
  // depending on screen size. We need to parse this properly to get the true image source.
  function parseSrcsetCandidate(srcset) {
    const normalized = normalizeUrl(srcset);
    if (!normalized) return "";

    const firstCandidate = normalized.split(",")[0];
    if (!firstCandidate) return "";

    return normalizeUrl(firstCandidate.split(/\s+/)[0]);
  }

  // Data/Blob URLs mean the image is generated in-memory (e.g., our blurred canvas output).
  // We shouldn't process these because they're already handled.
  function isSyntheticSource(url) {
    return url.startsWith("data:") || url.startsWith("blob:");
  }

  function isProcessableSource(url) {
    if (!url || isSyntheticSource(url)) return false;

    // Skip animated thumbnails (hover previews)
    if (url.includes("/an_webp/") || url.includes(".mp4") || url.includes(".webm")) {
      return false;
    }
    return true;
  }

  /**
   * Determine the true source of an image element.
   * Browsers and generic frameworks (like YouTube's polymer) can inject the 
   * source in various ways. We check all candidate sources in priority order.
   */
  function getThumbnailSource(thumbnail) {
    const currentSrc = normalizeUrl(thumbnail.currentSrc);
    const attrSrc = normalizeUrl(thumbnail.getAttribute("src"));
    const propSrc = normalizeUrl(thumbnail.src);
    const srcsetSrc = parseSrcsetCandidate(thumbnail.getAttribute("srcset"));
    const candidates = [currentSrc, attrSrc, propSrc, srcsetSrc];

    for (const candidate of candidates) {
      if (isProcessableSource(candidate)) return candidate;
    }

    const fallback = candidates.find(Boolean) || "";
    if (isSyntheticSource(fallback)) {
      return thumbnail.dataset.faceBlurProcessedSource || "";
    }

    return fallback;
  }

  function isThumbnailCandidate(node) {
    return node instanceof HTMLImageElement && node.matches(THUMBNAIL_SELECTOR);
  }

  /**
   * LEAST-RECENTLY-USED (LRU) CACHE IMPLEMENTATION
   * Using Map preserves insertion order. Deleting and re-adding keys pushes them 
   * to the back of the queue. If we exceed MAX_ENTRIES, we delete the first (oldest) key.
   */
  function cacheResult(source, result) {
    if (resultCache.has(source)) resultCache.delete(source);
    resultCache.set(source, result);

    if (resultCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = resultCache.keys().next().value;
      if (oldestKey) resultCache.delete(oldestKey);
    }
  }

  // We use data attributes (dataset) to tag DOM elements with their processing state.
  // This is a standard way to track persistent state on elements without keeping 
  // giant arrays/maps in memory that could cause memory leaks.
  function markThumbnailProcessed(thumbnail, source, status) {
    thumbnail.dataset.faceBlurProcessedSource = source;
    thumbnail.dataset.faceBlurStatus = status;
    delete thumbnail.dataset.faceBlurObservedSource;
    delete thumbnail.dataset.faceBlurProcessingSource;
  }

  // Ensures our internal state matches the actual DOM state (e.g. if YouTube updates the image URL)
  function syncThumbnailState(thumbnail) {
    const source = getThumbnailSource(thumbnail);
    const processedSource = thumbnail.dataset.faceBlurProcessedSource || "";
    const observedSource = thumbnail.dataset.faceBlurObservedSource || "";
    const processingSource = thumbnail.dataset.faceBlurProcessingSource || "";

    if (processedSource && processedSource !== source) {
      delete thumbnail.dataset.faceBlurProcessedSource;
      delete thumbnail.dataset.faceBlurStatus;
    }

    if (observedSource && observedSource !== source) {
      delete thumbnail.dataset.faceBlurObservedSource;
    }

    if (processingSource && processingSource !== source) {
      delete thumbnail.dataset.faceBlurProcessingSource;
    }

    return source;
  }

  // Replaces the original image with our blurred canvas output via data URL.
  // Note the "internal update" tag so our MutationObserver knows to ignore this change.
  function applyBlurredImage(thumbnail, source, dataUrl) {
    thumbnail.dataset.faceBlurInternalUpdate = "true";
    markThumbnailProcessed(thumbnail, source, STATUS.BLURRED);
    thumbnail.removeAttribute("srcset"); // Srcset overrides src, so we must remove it
    thumbnail.src = dataUrl;
    
    // Clear the internal update flag on the next tick so future YouTube changes are tracked
    window.setTimeout(() => {
      delete thumbnail.dataset.faceBlurInternalUpdate;
    }, 0);
  }

  function applyCachedResult(thumbnail, source) {
    const cachedResult = resultCache.get(source);
    if (!cachedResult) return false;

    // LRU logic: promote cache hits so repeated thumbnails stay resident longer
    resultCache.delete(source);
    resultCache.set(source, cachedResult);

    if (cachedResult.status === STATUS.BLURRED) {
      applyBlurredImage(thumbnail, source, cachedResult.dataUrl);
      return true;
    }

    if (cachedResult.status === STATUS.CLEAN) {
      markThumbnailProcessed(thumbnail, source, STATUS.CLEAN);
      return true;
    }

    return false;
  }

  // We can't process images before they load. This event listener waits until
  // the image file is actually ready before pushing it to the processing pipeline.
  function ensureLoadListener(thumbnail) {
    if (thumbnail.dataset.faceBlurLoadBound === "true") return;

    thumbnail.dataset.faceBlurLoadBound = "true";
    thumbnail.addEventListener("load", () => {
      // Ignore load events caused by us applying the blurred data URL
      if (thumbnail.dataset.faceBlurInternalUpdate === "true") return;
      prepareThumbnail(thumbnail);
    });
  }

  // IntersectionObserver is vital for performance. Instead of analyzing hundreds of 
  // thumbnails deep in the page, we only queue them up when they are getting close
  // to the user's viewport (rootMargin handles this "buffer" zone).
  function observeThumbnail(thumbnail, source) {
    if (!intersectionObserver || !thumbnail.isConnected) return;

    thumbnail.dataset.faceBlurObservedSource = source;
    intersectionObserver.observe(thumbnail);
  }

  function prepareThumbnail(thumbnail) {
    if (!modelsReady || !isThumbnailCandidate(thumbnail)) return;

    ensureLoadListener(thumbnail);
    const source = syncThumbnailState(thumbnail);

    if (!isProcessableSource(source)) return;
    if (thumbnail.dataset.faceBlurProcessedSource === source) return;
    if (thumbnail.dataset.faceBlurProcessingSource === source) return;
    if (thumbnail.dataset.faceBlurObservedSource === source) return;
    if (applyCachedResult(thumbnail, source)) return;

    // Sometimes images are registered but not physically laid out yet.
    if (!thumbnail.complete || !thumbnail.naturalWidth || !thumbnail.naturalHeight) return;

    observeThumbnail(thumbnail, source);
  }

  function collectThumbnails(root) {
    if (root instanceof HTMLImageElement) {
      return isThumbnailCandidate(root) ? [root] : [];
    }

    if (!(root instanceof Element || root instanceof Document)) return [];
    return Array.from(root.querySelectorAll(THUMBNAIL_SELECTOR));
  }

  function processYouTubeThumbnails(root = document) {
    for (const thumbnail of collectThumbnails(root)) {
      prepareThumbnail(thumbnail);
    }
  }

  const debouncedProcessThumbnails = debounce(
    () => processYouTubeThumbnails(document),
    DEBOUNCE_DELAY
  );

  /**
   * CORS AND TAINTED CANVASES
   * If a canvas context draws an image from a different domain, it becomes "tainted",
   * and we can't extract pixel data (toURL) later due to browser security policies.
   * Fetching the image via an AbortController and creating an Object URL avoids this
   * because we execute a true cross-origin request first (assuming CORS headers allow it).
   */
  async function createUntaintedImage(imageUrl) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const response = await fetch(imageUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.decoding = "async"; // Don't block the main thread while decoding the image

      return await new Promise((resolve, reject) => {
        image.onload = () => resolve({ image, objectUrl });
        image.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("Failed to load fetched thumbnail"));
        };
        image.src = objectUrl;
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function clampBlurBox(box, width, height) {
    const left = Math.max(0, Math.floor(box.x - FACE_BLUR_PADDING));
    const top = Math.max(0, Math.floor(box.y - FACE_BLUR_PADDING));
    const right = Math.min(width, Math.ceil(box.x + box.width + FACE_BLUR_PADDING));
    const bottom = Math.min(height, Math.ceil(box.y + box.height + FACE_BLUR_PADDING));

    return {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  // Intersection Over Union (IOU) is a common computer vision metric.
  // It determines how much two bounding boxes overlap. We use this to prevent
  // the secondary model from returning duplicate detections of the primary model.
  function getIntersectionOverUnion(firstBox, secondBox) {
    const left = Math.max(firstBox.x, secondBox.x);
    const top = Math.max(firstBox.y, secondBox.y);
    const right = Math.min(firstBox.x + firstBox.width, secondBox.x + secondBox.width);
    const bottom = Math.min(firstBox.y + firstBox.height, secondBox.y + secondBox.height);

    const intersectionWidth = Math.max(0, right - left);
    const intersectionHeight = Math.max(0, bottom - top);
    const intersectionArea = intersectionWidth * intersectionHeight;

    if (intersectionArea === 0) return 0;

    const firstArea = firstBox.width * firstBox.height;
    const secondArea = secondBox.width * secondBox.height;
    const unionArea = firstArea + secondArea - intersectionArea;

    return unionArea > 0 ? intersectionArea / unionArea : 0;
  }

  function mergeDetections(primaryDetections, secondaryDetections) {
    const mergedDetections = [...primaryDetections];

    for (const secondaryDetection of secondaryDetections) {
      const isDuplicate = mergedDetections.some(
        (existingDetection) =>
          getIntersectionOverUnion(existingDetection.box, secondaryDetection.box) >=
          DETECTION_IOU_THRESHOLD
      );

      if (!isDuplicate) mergedDetections.push(secondaryDetection);
    }

    return mergedDetections;
  }

  async function detectFaces(canvas) {
    const primaryDetections = await faceapi.detectAllFaces(
      canvas,
      new faceapi.TinyFaceDetectorOptions(PRIMARY_FACE_DETECTION_OPTIONS)
    );

    if (primaryDetections.length > SECONDARY_DETECTION_TRIGGER_COUNT) {
      return primaryDetections;
    }

    const secondaryDetections = await faceapi.detectAllFaces(
      canvas,
      new faceapi.TinyFaceDetectorOptions(SECONDARY_FACE_DETECTION_OPTIONS)
    );

    if (primaryDetections.length === 0) return secondaryDetections;

    return mergeDetections(primaryDetections, secondaryDetections);
  }

  // CONCURRENCY LIMITER: A critical pattern for browser stability.
  // Recursively drains the queue but never exceeds MAX_CONCURRENT_PROCESSES running at once.
  function drainQueue() {
    while (activeProcesses < MAX_CONCURRENT_PROCESSES && processingQueue.length > 0) {
      const thumbnail = processingQueue.shift();
      activeProcesses++;

      processSingleThumbnail(thumbnail)
        .catch((error) => console.error("[YouTube Face Blur] Error processing thumbnail", error))
        .finally(() => {
          activeProcesses--;
          drainQueue();
        });
    }
  }

  // When a thumbnail enters the viewport, we push it to the processing queue.
  function enqueueThumbnail(thumbnail) {
    const source = syncThumbnailState(thumbnail);

    if (!isProcessableSource(source)) return;
    if (thumbnail.dataset.faceBlurProcessedSource === source) return;
    if (thumbnail.dataset.faceBlurProcessingSource === source) return;
    if (applyCachedResult(thumbnail, source)) return;

    thumbnail.dataset.faceBlurProcessingSource = source;
    delete thumbnail.dataset.faceBlurObservedSource;
    processingQueue.push(thumbnail);
    drainQueue();
  }

  /**
   * AI PROCESSING PIPELINE
   * This handles fetching the image, feeding it to the face-api model,
   * drawing the blur boxes over detections, and returning the blob output.
   */
  async function processSingleThumbnail(thumbnail) {
    if (!thumbnail?.isConnected) return;

    const source = syncThumbnailState(thumbnail);
    if (!isProcessableSource(source)) {
      delete thumbnail.dataset.faceBlurProcessingSource;
      return;
    }

    if (thumbnail.dataset.faceBlurProcessedSource === source) {
      delete thumbnail.dataset.faceBlurProcessingSource;
      return;
    }

    if (applyCachedResult(thumbnail, source)) {
      delete thumbnail.dataset.faceBlurProcessingSource;
      return;
    }

    let canvas = null;
    let objectUrl = "";

    try {
      const { image, objectUrl: createdObjectUrl } = await createUntaintedImage(source);
      objectUrl = createdObjectUrl;

      if (image.naturalWidth === 0 || image.naturalHeight === 0) {
        markThumbnailProcessed(thumbnail, source, STATUS.CLEAN);
        cacheResult(source, { status: STATUS.CLEAN });
        return;
      }

      canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Unable to get canvas context");

      // Draw the clean image to the canvas first
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      // Run our dual-tier face detection
      const detections = await detectFaces(canvas);

      if (detections.length === 0) {
        markThumbnailProcessed(thumbnail, source, STATUS.CLEAN);
        cacheResult(source, { status: STATUS.CLEAN });
        return;
      }

      // We found faces! For each face, clamp the bounding box to the real dimensions
      for (const detection of detections) {
        const blurBox = clampBlurBox(detection.box, canvas.width, canvas.height);
        if (!blurBox.width || !blurBox.height) continue;

        // Apply a CSS blur filter while redrawing the explicit cropped region
        context.filter = `blur(${BLUR_INTENSITY})`;
        context.drawImage(
          image,
          blurBox.x, blurBox.y, blurBox.width, blurBox.height,
          blurBox.x, blurBox.y, blurBox.width, blurBox.height
        );
        context.filter = "none";
      }

      // Convert our blurred canvas into a base64 Data URL for the src tag
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      cacheResult(source, { status: STATUS.BLURRED, dataUrl });

      if (thumbnail.isConnected && getThumbnailSource(thumbnail) === source) {
        applyBlurredImage(thumbnail, source, dataUrl);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        console.warn("[YouTube Face Blur] Timed out fetching thumbnail", source);
      } else if (error instanceof TypeError) {
        console.warn("[YouTube Face Blur] Network error fetching thumbnail", source);
      } else {
        console.error("[YouTube Face Blur] Failed to blur thumbnail", source, error);
      }
      markThumbnailProcessed(thumbnail, source, STATUS.FAILED);
    } finally {
      // CRITICAL: MEMORY MANAGEMENT
      // Always revoke object URLs explicitly to avoid leaks
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      
      // Resizing canvases to 0 frees their memory buffer instantly rather than waiting for garbage collection
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      delete thumbnail.dataset.faceBlurProcessingSource;
    }
  }

  function setupIntersectionObserver() {
    // We observe elements just before they enter the viewport (250px rootMargin)
    // so they are usually done processing before the user sees them.
    intersectionObserver = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          observer.unobserve(entry.target);
          delete entry.target.dataset.faceBlurObservedSource;
          enqueueThumbnail(entry.target);
        }
      },
      { rootMargin: "250px 0px", threshold: 0.01 }
    );
  }

  /**
   * DOM MUTATION OBSERVER
   * SPAs like YouTube rarely trigger page load events after the initial load. 
   * They aggressively dynamically insert elements or modify attributes instead.
   * This observer is critical for catching new video nodes loaded via infinite scroll.
   */
  function setupMutationObserver() {
    if (mutationObserver) mutationObserver.disconnect();

    mutationObserver = new MutationObserver((mutations) => {
      let shouldRescan = false;

      for (const mutation of mutations) {
        // Did the image URL change on an existing thumbnail?
        if (mutation.type === "attributes") {
          const thumbnail = mutation.target;
          if (isThumbnailCandidate(thumbnail) && thumbnail.dataset.faceBlurInternalUpdate !== "true") {
            prepareThumbnail(thumbnail);
          }
          continue;
        }

        // Did new DOM nodes get appended to the page?
        if (mutation.type !== "childList" || mutation.addedNodes.length === 0) continue;

        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (isThumbnailCandidate(node) || node.querySelector(THUMBNAIL_SELECTOR)) {
            shouldRescan = true;
            break;
          }
        }

        if (shouldRescan) break;
      }

      if (shouldRescan) debouncedProcessThumbnails();
    });

    const targetNode = document.querySelector("ytd-app") || document.body;
    mutationObserver.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset"],
    });
  }

  /**
   * SPA ROUTING HANDLER
   * Since window.onload only fires once per session, we must listen to the specific
   * frameworks routing events. On YouTube, this is "yt-navigate-finish".
   */
  function setupNavigationListeners() {
    const rescan = () => {
      // Delay processing slightly to let the framework establish its DOM structure
      window.setTimeout(() => {
        processYouTubeThumbnails(document);
      }, SPA_NAVIGATION_DELAY);
    };

    window.addEventListener("yt-navigate-finish", rescan);
    window.addEventListener("popstate", rescan); // Fallback for native history navigation
  }

  // Initializes the whole system with robust retry logic because Chrome extensions 
  // can occasionally fail to read internal bundle files immediately upon load.
  async function loadModelsWithRetry(retries = 3, delay = 1000) {
    if (modelsReady) return;
    if (typeof faceapi === "undefined") {
      console.error("[YouTube Face Blur] face-api.js is not available");
      return;
    }

    const modelUrl = chrome.runtime.getURL("models");

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl);
        modelsReady = true;
        setupIntersectionObserver();
        setupMutationObserver();
        setupNavigationListeners();
        processYouTubeThumbnails(document);
        return;
      } catch (error) {
        console.warn(`[YouTube Face Blur] Failed to load model (attempt ${attempt + 1}/${retries})`, error);
        if (attempt < retries - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, delay * Math.pow(2, attempt)));
        }
      }
    }

    console.error("[YouTube Face Blur] Failed to load face detection model");
  }

  // --- ENTRY POINT ---
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => loadModelsWithRetry(), { once: true });
  } else {
    loadModelsWithRetry();
  }
})();

