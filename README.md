# YouTube Thumbnail Face Blur

A high-performance Chrome extension that automatically detects and blurs faces in YouTube thumbnail images to create a less distracting browsing experience.

## Features

- **Smart Face Detection**: Uses face-api.js with TinyFaceDetector for accurate, efficient face detection
- **Lazy Loading**: Only processes thumbnails when they're visible or about to become visible
- **Parallel Processing**: Handles multiple thumbnails concurrently (up to 3 at once) for faster performance
- **Automatic Retry**: Recovers gracefully from network issues with exponential backoff
- **Memory Efficient**: Proper cleanup of canvases and resources to prevent memory leaks
- **SPA Navigation**: Handles YouTube's single-page application navigation seamlessly

## Installation

1. Download the extension files to your computer
2. Download the face-api.js library from https://github.com/justadudewhohacks/face-api.js/tree/master/dist and place `face-api.min.js` in the extension directory
3. Download the pre-trained models from https://github.com/justadudewhohacks/face-api.js/tree/master/weights:
   - `tiny_face_detector_model` files
   - `face_landmark_68_model` files

   Place them in a folder called `models` in the extension directory
4. Open Chrome and go to `chrome://extensions/`
5. Enable "Developer mode" (toggle in the top right)
6. Click "Load unpacked" and select the extension directory
7. Navigate to YouTube and the extension will automatically blur faces in thumbnails

## How It Works

The extension uses a sophisticated multi-stage approach:

1. **Detection**: Uses face-api.js with TinyFaceDetector and 68-point facial landmark detection
2. **Lazy Loading**: IntersectionObserver monitors thumbnails and only processes those near the viewport
3. **Queue Management**: Thumbnails are processed in a queue with concurrency limiting (max 3 simultaneous)
4. **CORS Handling**: Fetches images with a 15-second timeout to bypass CORS restrictions
5. **Blur Application**: Detected faces are blurred using canvas filters with configurable padding
6. **Cleanup**: Automatic cleanup of canvases, object URLs, and processing flags to prevent memory leaks

## Performance

- **Parallel Processing**: Up to 3 thumbnails processed simultaneously
- **Lazy Loading**: 200px viewport margin for smart preloading
- **Optimized Observers**: MutationObserver targets specific YouTube containers (`ytd-app`) instead of entire document
- **Network Resilience**: 15-second fetch timeout prevents hanging on slow connections
- **Auto-Retry**: Model loading retries up to 3 times with exponential backoff

## Customization

You can modify these constants in `content.js` to customize behavior:

- `BLUR_INTENSITY` (default: "15px"): Strength of the blur effect
- `FACE_BLUR_PADDING` (default: 10): Pixels of padding around detected faces
- `MAX_CONCURRENT_PROCESSES` (default: 3): Maximum number of simultaneous thumbnail processes
- `FETCH_TIMEOUT` (default: 15000ms): Timeout for fetching thumbnail images
- `DEBOUNCE_DELAY` (default: 250ms): Delay before processing new thumbnails after DOM changes

## Technical Details

- **Manifest Version**: 3
- **Content Script**: Runs at `document_idle` for optimal performance
- **Permissions**: Requires access to `youtube.com`, `ytimg.com`, and `gstatic.com` for image fetching
- **Face Detection**: TinyFaceDetector with 0.5 score threshold
- **Navigation Handling**: Listens to YouTube's `yt-navigate-finish` event and standard `popstate` events

## Maintenance Note

YouTube frequently updates its website structure and class names. If the extension stops working after a YouTube update, the selectors in `content.js` may need to be updated to match YouTube's current DOM structure.

Current selectors:
- `img.yt-core-image`
- `ytd-thumbnail img`
- `ytd-rich-grid-media img.yt-img-shadow`
- `ytd-compact-video-renderer img`
- `ytd-grid-video-renderer img`
- `ytd-reel-item-renderer img`

## Troubleshooting

### Faces are not being blurred
1. **Refresh the page**: Sometimes the extension needs a fresh page load to initialize.
2. **Check your internet connection**: The extension needs to download face detection models on the first run.
3. **Check console for errors**: Open Developer Tools (F12) -> Console. Look for errors starting with `[YouTube Face Blur]`.
4. **YouTube Update**: If YouTube updated their layout, the extension might need an update. Check the [GitHub repository](https://github.com/ryanjohnson/youtube-face-blur) for updates.

### Extension causes lag
The extension is optimized for performance, but face detection is computationally expensive.
- Try reducing the number of open YouTube tabs.
- Ensure hardware acceleration is enabled in Chrome settings.

## Privacy Policy

**We value your privacy.**

- **Local Processing**: All face detection and image processing happens locally on your device within your browser.
- **No Data Collection**: This extension does not collect, store, or transmit any personal data, browsing history, or images.
- **No Analytics**: We do not track how you use the extension.
- **Permissions**: The permissions requested are strictly for accessing YouTube thumbnail images to apply the blur effect.

## Development

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- [npm](https://www.npmjs.com/)

### Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/ryanjohnson/youtube-face-blur.git
   ```
2. Install dependencies (for linting/formatting):
   ```bash
   npm install
   ```

### Linting & Formatting
- Run linter: `npm run lint`
- Format code: `npm run format`

### Project Structure
- `content.js`: Main logic for face detection and blurring.
- `models/`: Pre-trained face-api.js models.
- `manifest.json`: Chrome extension configuration.
- `face-api.min.js`: Face detection library.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

