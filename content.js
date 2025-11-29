// content.js - hide all YouTube thumbnails via CSS
(function () {
  const STYLE_ID = "yt-face-blur-hide-style";
  const HIDE_SELECTORS = [
    ".yt-lockup-view-model--vertical.yt-lockup-view-model--rich-grid-legacy-margin .yt-lockup-view-model__content-image",
    "img.yt-core-image",
    "img.yt-core-image--fill-parent-height",
    "img.yt-core-image--fill-parent-width",
    "img#img",
    "ytd-thumbnail img",
    "ytd-rich-grid-media img.yt-img-shadow",
    "ytd-compact-video-renderer img",
    "ytd-grid-video-renderer img",
    "ytd-reel-item-renderer img",
  ];

  function injectHideStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
${HIDE_SELECTORS.join(", ")} {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  filter: blur(40px) !important;
}`;
    document.documentElement.appendChild(style);
  }

  function start() {
    injectHideStyles();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})(); // End IIFE
