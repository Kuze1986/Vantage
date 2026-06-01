/**
 * DemoForge Integration Template
 *
 * This is a template showing how to integrate the Vantage demo walkthrough
 * with DemoForge video generation. It breaks the single walkthrough script
 * into DemoForge-compatible steps that can be recorded, narrated, and mixed.
 *
 * Usage:
 *   1. Copy the step definitions from demo-walkthrough.ts
 *   2. Convert each step to the DemoForge script format
 *   3. Add narration snippets for each step
 *   4. Use DemoForgePage to create and run the template
 *
 * Example DemoForge template structure:
 * ```json
 * {
 *   "name": "Vantage Platform Tour",
 *   "tagline": "Complete walkthrough of content creation & distribution",
 *   "audience": "Prospective customers, investors",
 *   "format": "linkedin",
 *   "steps": [
 *     {
 *       "action": "navigate",
 *       "url": "{BASE}/login",
 *       "narration": "Welcome to Vantage. We're going to walk you through the entire platform."
 *     },
 *     ...
 *   ]
 * }
 * ```
 */

export const VANTAGE_PLATFORM_TOUR = {
  name: "Vantage Platform Tour",
  tagline: "Complete walkthrough of content creation & distribution",
  audience: "Prospective customers, investors, partners",
  format: "linkedin" as const,
  estimatedDuration: "4:30",
  steps: [
    // ─── STEP 1: Login & Dashboard ──────────────────────────────────────
    {
      action: "navigate" as const,
      selector: "{BASE}/login",
      wait: 1000,
      narration:
        "Welcome to Vantage, the platform built to amplify your content. Let's log in and take a tour of the platform.",
    },
    {
      action: "fill",
      selector: 'input[type="email"]',
      text: "demo@vantage.example.com",
      wait: 500,
      narration: "",
    },
    {
      action: "fill",
      selector: 'input[type="password"]',
      text: "demo123",
      wait: 500,
      narration: "",
    },
    {
      action: "click",
      selector: 'button:has-text("Sign in")',
      wait: 2000,
      narration: "",
    },
    {
      action: "navigate",
      selector: "{BASE}/",
      wait: 2000,
      narration:
        "Here's your dashboard—a real-time overview of your content performance, upcoming scheduled posts, and engagement metrics.",
    },
    {
      action: "scroll",
      wait: 1500,
      narration:
        "You can see all your key metrics: total followers, engagement rate, and content performance across platforms.",
    },
    {
      action: "scroll",
      wait: 1000,
      narration: "",
    },

    // ─── STEP 2: Queue (Content Management) ─────────────────────────────
    {
      action: "click",
      selector: 'a[href="/queue"]',
      wait: 2000,
      narration:
        "The Queue is where you manage all your content. Here you can see drafts, scheduled posts, and published content in one place.",
    },
    {
      action: "scroll",
      wait: 1500,
      narration:
        "Each piece shows its status, target platforms, and when it's scheduled to go live. You can edit, reschedule, or publish directly from the queue.",
    },
    {
      action: "scroll",
      wait: 1000,
      narration: "",
    },

    // ─── STEP 3: Calendar (Publishing Schedule) ──────────────────────────
    {
      action: "click",
      selector: 'a[href="/calendar"]',
      wait: 2000,
      narration:
        "The Calendar gives you a visual overview of all your scheduled content. Plan your entire week or month at a glance.",
    },
    {
      action: "scroll",
      wait: 1500,
      narration:
        "You can drag and drop to reschedule posts, view conflicts, and ensure consistent posting across all your channels.",
    },
    {
      action: "scroll",
      wait: 1000,
      narration: "",
    },

    // ─── STEP 4: Analytics (Intelligence) ───────────────────────────────
    {
      action: "click",
      selector: 'a[href="/analytics"]',
      wait: 2000,
      narration:
        "Analytics shows you what's working. Track engagement, reach, impressions, and audience growth across all platforms.",
    },
    {
      action: "scroll",
      wait: 1500,
      narration:
        "Use these insights to refine your content strategy. See which topics resonate, what times perform best, and who's engaging most.",
    },
    {
      action: "scroll",
      wait: 1500,
      narration: "",
    },
    {
      action: "scroll",
      wait: 1000,
      narration: "",
    },

    // ─── STEP 5: Channels (Platform Integration) ─────────────────────────
    {
      action: "click",
      selector: 'a[href="/channels"]',
      wait: 2000,
      narration:
        "Connect all your platforms. Vantage syncs with X, LinkedIn, Instagram, TikTok, and more. One dashboard, all your channels.",
    },
    {
      action: "scroll",
      wait: 1500,
      narration:
        "Manage permissions, audience insights, and performance metrics for each channel without leaving Vantage.",
    },
    {
      action: "scroll",
      wait: 1000,
      narration: "",
    },

    // ─── STEP 6: Voice Config (Brand Identity) ──────────────────────────
    {
      action: "click",
      selector: 'a[href="/voice"]',
      wait: 2000,
      narration:
        "Define your brand voice. Set tone, style, and messaging guidelines so your content stays consistent across every platform.",
    },
    {
      action: "scroll",
      wait: 1500,
      narration:
        "This guides AI-assisted writing and ensures every piece of content aligns with your brand identity.",
    },
    {
      action: "scroll",
      wait: 1000,
      narration: "",
    },

    // ─── STEP 7: Settings (Workspace Management) ─────────────────────────
    {
      action: "click",
      selector: 'a[href="/settings"]',
      wait: 2000,
      narration:
        "Manage your workspace here. Add team members, configure integrations, and set up automations to streamline your workflow.",
    },
    {
      action: "scroll",
      wait: 1500,
      narration: "",
    },
    {
      action: "scroll",
      wait: 1000,
      narration: "",
    },

    // ─── STEP 8: Return to Dashboard (Full Loop) ─────────────────────────
    {
      action: "click",
      selector: 'a[href="/"]',
      wait: 2000,
      narration:
        "That's Vantage in a nutshell. One platform to create, schedule, publish, and measure your content across every channel.",
    },
    {
      action: "scroll",
      selector: "{BASE}/",
      wait: 1500,
      narration:
        "Ready to amplify your content? Sign up for Vantage today and see the difference a unified platform can make.",
    },
  ],
};

/**
 * Alternative: Shorter 2-minute version (LinkedIn social post)
 */
export const VANTAGE_QUICK_DEMO = {
  name: "Vantage: 2-Minute Platform Overview",
  tagline: "Quick tour of content creation, scheduling & analytics",
  audience: "Social media managers, content creators",
  format: "linkedin" as const,
  estimatedDuration: "2:15",
  steps: [
    {
      action: "navigate" as const,
      selector: "{BASE}/",
      wait: 2000,
      narration:
        "Vantage: One platform to create, schedule, and measure all your content across X, LinkedIn, Instagram, TikTok, and more.",
    },
    {
      action: "click",
      selector: 'a[href="/queue"]',
      wait: 1500,
      narration: "Manage your entire content pipeline in the Queue.",
    },
    {
      action: "click",
      selector: 'a[href="/calendar"]',
      wait: 1500,
      narration: "Plan your month in the Calendar.",
    },
    {
      action: "click",
      selector: 'a[href="/analytics"]',
      wait: 1500,
      narration: "Measure impact with real-time Analytics.",
    },
    {
      action: "click",
      selector: 'a[href="/"]',
      wait: 1500,
      narration: "Try Vantage free. No credit card required.",
    },
  ],
};

/**
 * Alternative: Feature-focused version (for specific product pitch)
 */
export const VANTAGE_AI_ASSISTANT = {
  name: "Vantage AI Content Assistant",
  tagline: "AI-powered content generation & optimization",
  audience: "Teams using AI tools, productivity-focused creators",
  format: "linkedin" as const,
  estimatedDuration: "3:45",
  steps: [
    {
      action: "navigate" as const,
      selector: "{BASE}/",
      wait: 2000,
      narration:
        "Introducing Vantage AI Assistant—your personal content strategist.",
    },
    {
      action: "click",
      selector: 'a[href="/voice"]',
      wait: 1500,
      narration:
        "First, define your brand voice. This becomes your AI assistant's north star.",
    },
    {
      action: "click",
      selector: 'a[href="/queue"]',
      wait: 1500,
      narration:
        "Use AI to generate content ideas, write drafts, and optimize for each platform—all without leaving Vantage.",
    },
    {
      action: "click",
      selector: 'a[href="/analytics"]',
      wait: 1500,
      narration:
        "The AI learns from your performance data to suggest better topics, timing, and formats.",
    },
    {
      action: "click",
      selector: 'a[href="/"]',
      wait: 1500,
      narration:
        "Let AI handle the creative grunt work. You focus on strategy and engagement.",
    },
  ],
};

/**
 * Helper: Convert template to DemoForge script format
 * This transforms the step structure above into what DemoForgePage.tsx expects
 */
export function templateToDemoForgeScript(
  template: (typeof VANTAGE_PLATFORM_TOUR),
  baseUrl: string,
) {
  return {
    name: template.name,
    tagline: template.tagline,
    audience: template.audience,
    format: template.format,
    script: template.steps.map((step) => ({
      action: step.action,
      selector:
        step.action === "navigate"
          ? step.selector?.replace("{BASE}", baseUrl)
          : step.selector,
      text: step.text || "",
      ms: step.wait || 1000,
      narration: step.narration || "",
    })),
  };
}
