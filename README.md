# YouTube Thumbnail Face Blur

## Stop Getting Manipulated By Clickbait Faces

Tired of the endless parade of shocked expressions, exaggerated reactions, and AI-generated faces screaming for your attention? Every thumbnail designed to trigger you, distract you, and drag you down a rabbit hole you didn't ask for?

**Your brain deserves better.**

This Chrome extension automatically detects and blurs faces in YouTube thumbnails, giving you back control over what grabs your attention. Browse YouTube without the constant visual assault of clickbait faces engineered to hijack your focus.

### Why This Matters

YouTube thumbnails have become a mental tax. Content creators have discovered that exaggerated facial expressions trigger our primal attention mechanisms - and they're weaponizing it. Every scroll becomes an exhausting gauntlet of manufactured outrage, fake surprise, and calculated shock.

This extension removes that noise. You can finally browse based on **what you actually want to watch**, not what some algorithm thinks will manipulate you into clicking.

## What You Get

- **Instant Mental Relief**: No more visual clutter. No more manipulation. Just clean, distraction-free browsing.
- **Automatic & Fast**: Processes thumbnails in real-time as you scroll. You won't even notice it working.
- **100% Privacy**: Everything runs locally in your browser. Zero tracking. Zero data collection. Zero creepy surveillance.
- **Lightweight Performance**: Smart lazy-loading means it only processes what you're actually looking at.
- **Set & Forget**: Install once, benefit forever. No settings to fiddle with (unless you want to).

## Installation

**Quick Setup (5 minutes):**

1. **Download this extension**
   - Clone or download this repository to your computer

2. **Get the AI models** (required for face detection)
   - Download `face-api.min.js` from [here](https://github.com/justadudewhohacks/face-api.js/tree/master/dist) → put it in the extension folder
   - Download these model files from [here](https://github.com/justadudewhohacks/face-api.js/tree/master/weights):
     - `tiny_face_detector_model-shard1`
     - `tiny_face_detector_model-weights_manifest.json`
     - `face_landmark_68_model-shard1`
     - `face_landmark_68_model-weights_manifest.json`
   - Create a folder called `models` inside the extension folder
   - Put all the model files in that `models` folder

3. **Load the extension in Chrome**
   - Open Chrome and type `chrome://extensions/` in the address bar
   - Turn on "Developer mode" (toggle in the top right corner)
   - Click "Load unpacked"
   - Select the extension folder

4. **Done!**
   - Go to YouTube and watch the faces blur automatically
   - No configuration needed

## How It Works

You install it. That's it. The extension does the rest.

**Behind the scenes** (for the curious):
- Uses advanced face detection AI to identify faces in thumbnails
- Only processes thumbnails you're actually looking at (not the entire page)
- Blurs detected faces automatically as you scroll
- Handles YouTube's endless scroll and navigation seamlessly
- Cleans up after itself to keep your browser running smoothly

## Why This Extension is Fast

Unlike basic image filters, this extension is **engineered for performance**:

- **Smart Processing**: Only works on thumbnails near your screen, not everything on the page
- **Parallel Power**: Processes multiple thumbnails at once without slowing down your browser
- **Memory Safe**: Automatically cleans up resources, so your browser doesn't get sluggish
- **Network Resilient**: Handles slow connections and retries failed operations automatically
- **Optimized Detection**: Targets specific YouTube elements instead of scanning the entire page

## Customization (Optional)

Want more blur? Less blur? You can tweak it.

Open `content.js` and modify these settings:

- **`BLUR_INTENSITY`** (default: "15px") - How blurry the faces get. Higher = more blur.
- **`FACE_BLUR_PADDING`** (default: 10) - Extra pixels blurred around faces. Increase if faces aren't fully covered.
- **`MAX_CONCURRENT_PROCESSES`** (default: 3) - How many thumbnails get processed at once. Lower this if you have a slower computer.

<details>
<summary><strong>Advanced Settings (for power users)</strong></summary>

- `FETCH_TIMEOUT` (default: 15000ms) - How long to wait for thumbnail images to load
- `DEBOUNCE_DELAY` (default: 250ms) - Delay before processing new thumbnails after scrolling

</details>

## Technical Details (For Developers)

Built with performance and privacy as first-class concerns:

- **Manifest Version 3**: Uses the latest Chrome extension standards
- **Content Security Policy**: Restricts scripts to prevent XSS attacks
- **Face Detection**: TinyFaceDetector with 68-point facial landmark detection
- **Lazy Processing**: IntersectionObserver with 200px viewport margin
- **Parallel Processing**: Queue-based concurrency limiting (max 3 simultaneous)
- **Memory Management**: Automatic cleanup of canvases and object URLs
- **Navigation Handling**: YouTube-specific event listeners (`yt-navigate-finish`) + standard popstate
- **Permissions**: Only requests access to `youtube.com`, `ytimg.com`, and `gstatic.com` - nothing more

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

### Faces aren't getting blurred?

**First, try this:**
1. Refresh the page (Ctrl+R or Cmd+R)
2. Make sure you have an internet connection (the AI models download on first run)
3. Give it a few seconds after the page loads

**Still not working?**
- Open Developer Tools (F12), click the Console tab, and look for any red error messages
- YouTube might have updated their layout - check the [GitHub repo](https://github.com/ryanjohnson/youtube-face-blur) for updates

### Browser feels slow?

Face detection is CPU-intensive. Here's how to fix it:
- Close unnecessary YouTube tabs (each one is processing faces)
- Turn on hardware acceleration in Chrome settings (Settings → System → Use hardware acceleration)
- Lower `MAX_CONCURRENT_PROCESSES` in content.js from 3 to 2 or 1

## Privacy: Zero Compromises

**Your data stays yours. Period.**

This extension is built on a simple principle: **we don't want your data, and we don't need it.**

- **100% Local Processing**: Every single face detection and blur operation happens entirely in your browser. Nothing leaves your computer.
- **Zero Data Collection**: We don't collect it. We don't store it. We don't transmit it. Not your browsing history, not your watch history, not even anonymous usage stats.
- **No Analytics**: No tracking pixels. No telemetry. No "anonymized" data harvesting. Absolutely nothing.
- **No Network Calls**: The extension only touches YouTube to fetch thumbnail images for processing. That's it.
- **Open Source**: The code is right here. Read it yourself. Verify everything we're saying.

**Why?** Because surveillance capitalism is exhausting, and you shouldn't have to trade your privacy for a better YouTube experience.

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

---

## Take Back Your Attention

YouTube doesn't have to be an exhausting experience. You can browse for content you actually care about without getting visually assaulted by clickbait faces designed to manipulate you.

Install this extension and reclaim your mental space.

**Your focus is valuable. Protect it.**

---

## Contributing

Found a bug? Want to improve the face detection? Pull requests are welcome.

See [ROADMAP.md](ROADMAP.md) for planned features and development progress.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

