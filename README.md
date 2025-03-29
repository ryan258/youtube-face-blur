# YouTube Thumbnail Face Blur

This Chrome extension automatically detects and blurs faces in YouTube thumbnail images to create a less distracting browsing experience.

## Installation

1. Download the extension files to your computer
2. Download the face-api.js library from https://github.com/justadudewhohacks/face-api.js/tree/master/dist and place face-api.min.js in the extension directory
3. Download the pre-trained models from https://github.com/justadudewhohacks/face-api.js/tree/master/weights and place them in a folder called "models" in the extension directory
4. Open Chrome and go to `chrome://extensions/`
5. Enable "Developer mode" (toggle in the top right)
6. Click "Load unpacked" and select the extension directory
7. Navigate to YouTube and the extension will automatically blur faces in thumbnails

## Maintenance Note

YouTube frequently updates its website structure and class names. If the extension stops working after a YouTube update, the selectors in content.js may need to be updated to match YouTube's current DOM structure.

## How it works

The extension uses face-api.js, a JavaScript library for face detection, to identify faces in YouTube thumbnails. When a face is detected, the extension applies a blur effect to that specific area of the thumbnail.

## Customization

You can adjust the blur intensity by modifying the `BLUR_INTENSITY` constant in content.js. Higher values will create a stronger blur effect.
