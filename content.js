// content.js
(function () {
  // Constants for configuration
  const BLUR_INTENSITY = "15px";
  const DEBOUNCE_DELAY = 250;
  const SPA_NAVIGATION_DELAY = 500;
  const FACE_DETECTION_OPTIONS = { scoreThreshold: 0.5 };

  // --- New Function to create an untainted image ---
  async function createUntaintedImage(imageUrl) {
    try {
      const response = await fetch(imageUrl);
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
          reject(`Failed to load image from object URL: ${err}`);
        };
        img.src = objectURL;
      });
    } catch (fetchError) {
      console.error("Fetch error for image:", imageUrl, fetchError);
      throw fetchError; // Re-throw fetch errors
    }
  }
  // --- End of New Function ---

  // Process a single thumbnail (Modified)
  // Process a single thumbnail (Modified to skip likely previews)
  async function processSingleThumbnail(thumbnail) {
    if (thumbnail.dataset.faceBlurred) return;

    // --- Add check for preview URLs ---
    const imageUrl = thumbnail.src;
    if (
      !imageUrl ||
      imageUrl.includes("/an_webp/") ||
      imageUrl.includes(".mp4") ||
      imageUrl.includes(".webm")
    ) {
      // console.log('Skipping likely video preview:', imageUrl); // Optional: uncomment for debugging
      // Don't mark as blurred, as the static image might reappear later
      return; // Skip processing this URL
    }
    // --- End of check ---

    let untaintedImageData = null; // To store image and objectURL

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
        return;
      }

      const canvas = document.createElement("canvas");
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
          const padding = 10;
          ctx.filter = `blur(${BLUR_INTENSITY})`;
          ctx.drawImage(
            untaintedImage,
            box.x - padding,
            box.y - padding,
            box.width + padding * 2,
            box.height + padding * 2,
            box.x - padding,
            box.y - padding,
            box.width + padding * 2,
            box.height + padding * 2
          );
          ctx.filter = "none";
        }
        thumbnail.src = canvas.toDataURL(); // Update original thumbnail src
      }

      // Mark the ORIGINAL thumbnail as processed
      thumbnail.dataset.faceBlurred = "true";
    } catch (error) {
      // Check if the error is the specific fetch error we expect for previews
      if (error instanceof TypeError && error.message === "Failed to fetch") {
        console.warn("Fetch failed (likely preview skipped):", imageUrl);
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
    }
  }

  // Load face-api.js models (No changes needed here)
  async function loadModels() {
    const modelUrl = chrome.runtime.getURL("models");
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
      ]);
      console.log("Face detection models loaded");
      processYouTubeThumbnails();
      setupMutationObserver();
    } catch (error) {
      console.error("Failed to load face detection models:", error);
    }
  }

  // Process all YouTube thumbnails on the page (No changes needed here)
  async function processYouTubeThumbnails() {
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
      if (thumbnail.dataset.faceBlurred) {
        continue;
      }
      if (!thumbnail.complete || !thumbnail.naturalWidth) {
        // Check visibility before adding listener - optional optimization
        // const rect = thumbnail.getBoundingClientRect();
        // if (rect.top < window.innerHeight && rect.bottom >= 0) { // Basic visibility check
        thumbnail.addEventListener(
          "load",
          () => {
            if (!thumbnail.dataset.faceBlurred) {
              processSingleThumbnail(thumbnail);
            }
          },
          { once: true }
        );
        // }
        continue;
      }
      await processSingleThumbnail(thumbnail);
    }
  }

  // Debounce function (No changes needed here)
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

  // Setup MutationObserver (No changes needed here)
  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (
              node.nodeName === "IMG" ||
              (node.nodeType === 1 && node.querySelector("img"))
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
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    return observer;
  }

  // Start loading models (No changes needed here)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadModels);
  } else {
    loadModels();
  }

  // Handle SPA navigation (No changes needed here)
  let previousUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== previousUrl) {
      previousUrl = location.href;
      setTimeout(debouncedProcessThumbnails, SPA_NAVIGATION_DELAY);
    }
  });
  urlObserver.observe(document, { subtree: true, childList: true });
})(); // End of IIFE
