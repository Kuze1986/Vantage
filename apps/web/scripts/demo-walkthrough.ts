/**
 * Vantage Demo Walkthrough Script
 * Records a full platform walkthrough showcasing key features
 *
 * Usage:
 *   npx ts-node scripts/demo-walkthrough.ts [--url https://...] [--email user@...] [--password ...]
 *
 * Environment variables (alternative to CLI args):
 *   VANTAGE_DEMO_URL (default: http://localhost:5173)
 *   VANTAGE_DEMO_EMAIL (required)
 *   VANTAGE_DEMO_PASSWORD (required)
 *   DEMO_VIDEO_OUTPUT (optional, enables recording to file)
 */

import { chromium, Page } from 'playwright'

interface DemoConfig {
  baseUrl: string
  email: string
  password: string
  videoOutput?: string
}

// Parse CLI args and env vars
function getConfig(): DemoConfig {
  const args = new Map<string, string>()
  process.argv.slice(2).forEach((arg) => {
    const [key, val] = arg.split('=')
    if (key.startsWith('--')) args.set(key.slice(2), val || '')
  })

  return {
    baseUrl: args.get('url') || process.env.VANTAGE_DEMO_URL || 'http://localhost:5173',
    email: args.get('email') || process.env.VANTAGE_DEMO_EMAIL || '',
    password: args.get('password') || process.env.VANTAGE_DEMO_PASSWORD || '',
    videoOutput: process.env.DEMO_VIDEO_OUTPUT,
  }
}

// Helper to pause for effect (let UI settle, simulate reading)
async function pause(ms: number = 2000) {
  await new Promise((r) => setTimeout(r, ms))
}

// Helper for human-like typing
async function typeHuman(page: Page, selector: string, text: string, delayMs = 50) {
  await page.focus(selector)
  for (const char of text) {
    await page.keyboard.press(char.charCodeAt(0) > 127 ? 'Space' : char)
    await pause(delayMs)
  }
}

async function runDemo(config: DemoConfig) {
  if (!config.email || !config.password) {
    console.error('Error: VANTAGE_DEMO_EMAIL and VANTAGE_DEMO_PASSWORD are required')
    process.exit(1)
  }

  console.log(`🎬 Starting Vantage demo walkthrough...`)
  console.log(`   URL: ${config.baseUrl}`)
  console.log(`   Video output: ${config.videoOutput || 'none'}`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: config.videoOutput ? { dir: config.videoOutput } : undefined,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)

  try {
    // ── STEP 1: Login ──────────────────────────────────────────────────────
    console.log('📝 Step 1: Login')
    await page.goto(`${config.baseUrl}/login`, { waitUntil: 'networkidle' })
    await pause(1000)

    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')
    const loginButton = page.locator('button:has-text("Sign in")')

    await emailInput.fill(config.email)
    await pause(500)
    await passwordInput.fill(config.password)
    await pause(500)
    await loginButton.click()
    await page.waitForURL('/', { waitUntil: 'networkidle' })
    await pause(1500)

    // ── STEP 2: Dashboard Overview ─────────────────────────────────────────
    console.log('📊 Step 2: Dashboard')
    await page.goto(`${config.baseUrl}/`, { waitUntil: 'networkidle' })
    await pause(2000)

    // Scroll down to show KPI cards and recent activity
    await page.evaluate(() => window.scrollBy(0, 300))
    await pause(1500)
    await page.evaluate(() => window.scrollBy(0, 300))
    await pause(1500)
    await page.evaluate(() => window.scrollBy(0, -600))
    await pause(1000)

    // ── STEP 3: Queue (Content Pipeline) ───────────────────────────────────
    console.log('📋 Step 3: Queue')
    await page.click('a[href="/queue"]')
    await page.waitForURL('/queue', { waitUntil: 'networkidle' })
    await pause(1500)

    // Scroll through the queue to show content pieces
    await page.evaluate(() => window.scrollBy(0, 400))
    await pause(1000)
    await page.evaluate(() => window.scrollBy(0, 400))
    await pause(1000)

    // Click on a content piece to show details (if any exist)
    const firstQueueItem = page.locator('[data-testid="queue-item"]').first()
    if (await firstQueueItem.isVisible().catch(() => false)) {
      await firstQueueItem.click()
      await pause(1500)
      await page.keyboard.press('Escape')
      await pause(500)
    }

    await page.evaluate(() => window.scrollBy(0, -800))
    await pause(1000)

    // ── STEP 4: Calendar (Publishing Schedule) ─────────────────────────────
    console.log('📅 Step 4: Calendar')
    await page.click('a[href="/calendar"]')
    await page.waitForURL('/calendar', { waitUntil: 'networkidle' })
    await pause(1500)

    // Scroll through the calendar view
    await page.evaluate(() => window.scrollBy(0, 300))
    await pause(1500)
    await page.evaluate(() => window.scrollBy(0, -300))
    await pause(1000)

    // ── STEP 5: Analytics (Engagement & Intelligence) ──────────────────────
    console.log('📈 Step 5: Analytics')
    await page.click('a[href="/analytics"]')
    await page.waitForURL('/analytics', { waitUntil: 'networkidle' })
    await pause(2000)

    // Scroll through analytics dashboard
    await page.evaluate(() => window.scrollBy(0, 400))
    await pause(1500)
    await page.evaluate(() => window.scrollBy(0, 400))
    await pause(1500)
    await page.evaluate(() => window.scrollBy(0, -800))
    await pause(1000)

    // ── STEP 6: Channels (Platform Configuration) ──────────────────────────
    console.log('🔗 Step 6: Channels')
    await page.click('a[href="/channels"]')
    await page.waitForURL('/channels', { waitUntil: 'networkidle' })
    await pause(1500)

    // Scroll to show connected channels
    await page.evaluate(() => window.scrollBy(0, 300))
    await pause(1500)
    await page.evaluate(() => window.scrollBy(0, -300))
    await pause(1000)

    // ── STEP 7: Voice Configuration (Brand Identity) ───────────────────────
    console.log('🎤 Step 7: Voice Config')
    await page.click('a[href="/voice"]')
    await page.waitForURL('/voice', { waitUntil: 'networkidle' })
    await pause(1500)

    // Scroll through voice settings
    await page.evaluate(() => window.scrollBy(0, 300))
    await pause(1000)
    await page.evaluate(() => window.scrollBy(0, 300))
    await pause(1000)
    await page.evaluate(() => window.scrollBy(0, -600))
    await pause(1000)

    // ── STEP 8: Settings ───────────────────────────────────────────────────
    console.log('⚙️  Step 8: Settings')
    await page.click('a[href="/settings"]')
    await page.waitForURL('/settings', { waitUntil: 'networkidle' })
    await pause(1500)

    // Show account settings
    await page.evaluate(() => window.scrollBy(0, 300))
    await pause(1000)
    await page.evaluate(() => window.scrollBy(0, -300))
    await pause(1000)

    // ── STEP 9: Back to Dashboard (Full Loop) ──────────────────────────────
    console.log('🔄 Step 9: Return to Dashboard')
    await page.click('a[href="/"]')
    await page.waitForURL('/', { waitUntil: 'networkidle' })
    await pause(2000)

    // Fade out effect - scroll up to top
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await pause(1500)

    console.log('✅ Demo walkthrough complete!')

    if (config.videoOutput) {
      const videoPath = await page.video()?.path()
      console.log(`📹 Video saved to: ${videoPath}`)
    }
  } catch (error) {
    console.error('❌ Demo failed:', error)
    process.exit(1)
  } finally {
    await context.close()
    await browser.close()
  }
}

// Run the demo
const config = getConfig()
runDemo(config).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
