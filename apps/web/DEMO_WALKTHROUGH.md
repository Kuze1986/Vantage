# Vantage Demo Walkthrough Script

Automated script to record a complete walkthrough of the Vantage platform. Perfect for creating demo videos, documentation, or testing the UI flow.

## What It Does

The script logs in and walks through every major section of Vantage:
1. **Login** — authenticates with provided credentials
2. **Dashboard** — shows KPIs and pipeline overview
3. **Queue** — displays content status management
4. **Calendar** — shows publishing schedule
5. **Analytics** — displays engagement intelligence
6. **Channels** — shows platform connections
7. **Voice** — demonstrates brand voice configuration
8. **Settings** — account and workspace settings
9. **Return** — loops back to dashboard

Each step includes natural pauses and scrolling to simulate human interaction. Screens hold for 1-2 seconds for readability.

## Installation

Install Playwright (if not already installed):

```bash
cd apps/web
npm install --save-dev playwright tsx
```

## Usage

### Basic (No Video Recording)

```bash
npm run demo -- --email=user@example.com --password=securepass --url=http://localhost:5173
```

### With Video Recording

```bash
npm run demo -- --email=user@example.com --password=securepass --url=http://localhost:5173
export DEMO_VIDEO_OUTPUT=./videos
npm run demo -- --email=user@example.com --password=securepass
```

### Using Environment Variables

```bash
export VANTAGE_DEMO_URL=http://localhost:5173
export VANTAGE_DEMO_EMAIL=user@example.com
export VANTAGE_DEMO_PASSWORD=securepass
export DEMO_VIDEO_OUTPUT=./videos  # Optional

npm run demo
```

### CLI Arguments

- `--url` — Base URL of Vantage instance (default: `http://localhost:5173`)
- `--email` — Login email (required, or set `VANTAGE_DEMO_EMAIL`)
- `--password` — Login password (required, or set `VANTAGE_DEMO_PASSWORD`)

### Environment Variables

- `VANTAGE_DEMO_URL` — Base URL (default: `http://localhost:5173`)
- `VANTAGE_DEMO_EMAIL` — Login email (required)
- `VANTAGE_DEMO_PASSWORD` — Login password (required)
- `DEMO_VIDEO_OUTPUT` — Directory to save video file (optional, no recording if omitted)

## Examples

### Development Server

```bash
# Terminal 1: Start the dev server
npm run dev

# Terminal 2: Run demo (no recording)
VANTAGE_DEMO_EMAIL=demo@example.com VANTAGE_DEMO_PASSWORD=demo123 npm run demo
```

### Production Recording

```bash
export VANTAGE_DEMO_URL=https://app.vantage.example.com
export VANTAGE_DEMO_EMAIL=demo@example.com
export VANTAGE_DEMO_PASSWORD=securepass
export DEMO_VIDEO_OUTPUT=/tmp/vantage-demos

npm run demo
# Video will be saved to /tmp/vantage-demos/
```

### For DemoForge Integration

```bash
# You can use this script as a base for DemoForge template scripts
# Just extract the step logic into individual template steps:

# Step 1: Login and navigate dashboard
npx tsx -e "
  import { chromium } from 'playwright';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // ... your step logic here
  await browser.close();
"
```

## Customization

Edit `scripts/demo-walkthrough.ts` to:

- **Add pauses**: Change `pause(2000)` values to hold longer on key screens
- **Change URLs**: Modify step navigation (e.g., `page.goto('/analytics')`)
- **Add interactions**: Click buttons, fill forms, expand sections
- **Modify scrolling**: Adjust `window.scrollBy()` amounts
- **Add narration steps**: Insert `await page.waitForSelector()` to sync with external narration

### Example: Adding a Custom Step

```typescript
// After Calendar step, before Analytics
console.log('🎨 Step 4.5: Custom Feature')
await page.click('a[href="/custom"]')
await page.waitForURL('/custom', { waitUntil: 'networkidle' })
await pause(1500)

// Interact with the custom feature
await page.click('[data-testid="feature-button"]')
await pause(1000)
```

## Troubleshooting

### Login Fails

- Verify credentials are correct
- Check that the Vantage instance is running and accessible
- Ensure the login form selectors match (email input, password input, sign-in button)

### Videos Not Recording

- Ensure `DEMO_VIDEO_OUTPUT` directory exists
- Check disk space
- Verify Playwright was installed correctly: `npm list playwright`

### Timeouts

- Increase default timeout in script: `page.setDefaultTimeout(30000)`
- Check network connectivity to the Vantage instance
- Look for slow page loads or heavy computations on certain pages

### Selectors Not Found

- Open the Vantage app in a browser and inspect the DOM
- Update selectors in the script to match current markup
- Use `page.waitForSelector()` before clicking if timing issues occur

## Tips

- **Start with dev server**: Run the walkthrough against `http://localhost:5173` first
- **Create a demo user**: Use a dedicated demo account so walkthroughs don't interfere with real data
- **Pre-populate content**: Create sample content (posts, channels) before recording so the Queue/Calendar have something to show
- **Run headless or headed**: Remove `{ headless: true }` from `chromium.launch()` to see the browser during recording
- **Test selectors**: Add `console.log()` statements to verify elements exist before clicking

## Output

The script will log each step as it progresses:

```
🎬 Starting Vantage demo walkthrough...
   URL: http://localhost:5173
   Video output: none
📝 Step 1: Login
📊 Step 2: Dashboard
📋 Step 3: Queue
...
✅ Demo walkthrough complete!
```

If recording, the video path is printed at the end:

```
📹 Video saved to: /tmp/vantage-demos/screen-20260531-143022.webm
```

## Advanced: Sync with External Narration

To sync the walkthrough with external narration (via DemoForge or Vantage itself):

1. Run the script with video recording
2. Extract timing information from each `pause()` call
3. Generate narration at the same pace
4. Mix video + audio in post-production or via FFmpeg

## License

Part of the Vantage project. For internal demo use only.
