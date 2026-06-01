// brands.ts — per-product configuration that drives the entire Social Kit.
// Ported verbatim from the BioLoop Nexus "Social Kit" prototype (kit-brands.jsx).
// Every brand supplies: identity, palette, voice, captions, hashtags, and the
// copy for each editable template. Hex values are inlined (no shared const) so
// they survive PNG export and never collide across template scopes.

export type BrandId = 'shift' | 'keystone' | 'scripta' | 'demoforge' | 'crucible' | 'vantage'

export interface PaletteColor {
  name: string
  hex: string
  /** true = dark text on this swatch (light background) */
  dark: boolean
}

export interface BrandVoice {
  register: string
  do: string[]
  dont: string[]
}

export interface BrandCaption {
  tag: string
  tone: string
  title: string
  body: string
}

export interface BrandMetric {
  label: string
  value: string
  unit?: string
  color: string
}

export interface BrandLaunch {
  eyebrow: string
  sqHeadline: string
  sqSub: string
  xHeadline: string
  xSub: string
  liHeadline: string
  liSub: string
  storyHeadline: string
  storySub: string
  cta: string
  metrics: BrandMetric[]
}

export interface BrandInsight {
  group: string
  sqHeadline: string
  sqBody: string
  storyHeadline: string
  storyBody: string
  slotLabel: string
}

export interface Brand {
  id: BrandId
  name: string
  theme: string
  accent: string
  accent2: string
  handle: string
  domain: string
  essence: string
  statusLabel: string
  statusTone: string
  accentName: string
  eyebrowMeta: string
  palette: PaletteColor[]
  voice: BrandVoice
  captions: BrandCaption[]
  hashtags: Record<string, string>
  launch: BrandLaunch
  insight: BrandInsight
}

export const BRAND_ORDER: BrandId[] = ['shift', 'keystone', 'scripta', 'demoforge', 'crucible', 'vantage']

export const BRANDS: Record<BrandId, Brand> = {

  // ════════════════════════════════ THE SHIFT ════════════════════════
  shift: {
    id: 'shift', name: 'THE SHIFT', theme: 'theme-shift',
    accent: '#00C4E8', accent2: '#EFA020',
    handle: '@theshift', domain: 'theshift.bioloopnexus.com',
    essence: 'Operator Training System — pressure-trained certification prep.',
    statusLabel: 'NOW LIVE', statusTone: '#00E47A',
    accentName: 'SIGNAL CYAN + ALERT AMBER',
    eyebrowMeta: 'OUTREACH · ASSET PACKAGE',
    palette: [
      { name: 'VOID', hex: '#050C14', dark: false },
      { name: 'SURFACE', hex: '#0D1E30', dark: false },
      { name: 'SIGNAL CYAN', hex: '#00C4E8', dark: true },
      { name: 'ALERT AMBER', hex: '#EFA020', dark: true },
      { name: 'STRIKE RED', hex: '#E04040', dark: true },
      { name: 'CLEAR GREEN', hex: '#00E47A', dark: true },
    ],
    voice: {
      register: 'Confident and tactical — but human. Lead with the candidate’s win, not just the jargon.',
      do: ['“Train like it’s deployment day.”', 'Specific proof: “+18 pts. 91% pass first try.”'],
      dont: ['Walls of military slang with no payoff.', 'Fear-mongering about failing.'],
    },
    captions: [
      { tag: 'LAUNCH', tone: '#00C4E8', title: 'Launch announcement',
        body: 'Studying isn’t the same as performing. The Shift is live — a tactical training environment that drills you under real exam pressure across 14 modes. Build a plan, run the shift, walk in ready.\n\nStart free for 14 days. Link in bio.' },
      { tag: 'PROOF', tone: '#00E47A', title: 'Proof / stat drop',
        body: 'Operators using The Shift lift their scores by an average of +18 points and pass on the first try 91% of the time. Pressure-trained beats flashcard-tired.\n\nSee how it works → link in bio.' },
      { tag: 'DOCTRINE', tone: '#EFA020', title: 'Doctrine tip (carousel intro)',
        body: 'DOCTRINE 01 — Train at the pressure you’ll test at.\n\nQuiet, untimed practice builds false confidence. Add a timer, add stakes, and watch where your accuracy really sits. That gap is your study plan. ▶ Swipe.' },
      { tag: 'COMMUNITY', tone: '#00C4E8', title: 'Engagement prompt',
        body: 'What’s the one topic that makes your stomach drop on exam day? Drop it below 👇 — we’ll turn the top three into a free Boss Fight drill this week.' },
    ],
    hashtags: {
      core: '#TheShift #OperatorTraining #StudyIsDead',
      cdl: '#CDL #CDLexam #CDLtraining',
      nursing: '#NCLEX #NursingStudent #NCLEXprep',
      general: '#ExamPrep #TestPrep #CertificationExam',
    },
    launch: {
      eyebrow: 'OPERATOR TRAINING SYSTEM · v4.2',
      sqHeadline: 'STUDY IS DEAD. THE SHIFT IS LIVE.',
      sqSub: 'A tactical training environment that drills you under real exam pressure. 14 modes. Build a plan, run the shift, walk in ready.',
      xHeadline: 'STUDY IS DEAD. OPERATE.',
      xSub: 'The Shift drills you under real exam pressure across 14 modes — so test day feels like a shift you’ve already worked.',
      liHeadline: 'CERTIFICATION TRAINING, BUILT FOR PRESSURE.',
      liSub: 'The Shift moves candidates from passive review to performance under realistic exam conditions — measurable score lift, higher first-attempt pass rates.',
      storyHeadline: 'TRAIN LIKE IT’S DEPLOYMENT DAY.',
      storySub: 'Real pressure. 14 modes. The certification training built for the way exams actually feel.',
      cta: 'Start free · 14 days',
      metrics: [
        { label: 'MODES', value: '14', color: '#00C4E8' },
        { label: 'AVG SCORE LIFT', value: '+18', unit: 'pts', color: '#00E47A' },
        { label: 'FIRST-TRY PASS', value: '91', unit: '%', color: '#EFA020' },
      ],
    },
    insight: {
      group: 'DOCTRINE',
      sqHeadline: 'TRAIN AT THE PRESSURE YOU’LL TEST AT.',
      sqBody: 'Quiet, untimed practice builds false confidence. Add a timer and stakes, and watch where your accuracy really sits. That gap is your study plan.',
      storyHeadline: 'THE TIMER IS THE TEACHER.',
      storyBody: 'If you’ve never practiced against the clock, you’ve never met the version of yourself who shows up on exam day. Meet them early.',
      slotLabel: 'DROP OPERATOR / STUDY PHOTO',
    },
  },

  // ════════════════════════════════ KEYSTONE ═════════════════════════
  keystone: {
    id: 'keystone', name: 'KEYSTONE', theme: 'theme-keystone',
    accent: '#A4B8CC', accent2: '#00C4E8',
    handle: '@keystone.os', domain: 'keystone.bioloopnexus.com',
    essence: 'The workforce OS that follows through — intake to placement to alumni.',
    statusLabel: 'ALL MODULES NOMINAL', statusTone: '#00E47A',
    accentName: 'KEYSTONE SILVER + SIGNAL CYAN',
    eyebrowMeta: 'OUTREACH · ASSET PACKAGE',
    palette: [
      { name: 'VOID', hex: '#050C14', dark: false },
      { name: 'SURFACE', hex: '#0D1E30', dark: false },
      { name: 'KEYSTONE SILVER', hex: '#A4B8CC', dark: true },
      { name: 'SIGNAL CYAN', hex: '#00C4E8', dark: true },
      { name: 'STEEL', hex: '#4A6880', dark: false },
      { name: 'TEXT', hex: '#C8DCF0', dark: true },
    ],
    voice: {
      register: 'Authoritative, calm, systemic. Speak to program directors and workforce partners — outcomes over hype.',
      do: ['“From intake to placement, one record.”', 'Lead with outcomes: “894 placements. 87% retention.”'],
      dont: ['Tactical slang — Keystone is the calm one.', 'Vague “synergy” language.'],
    },
    captions: [
      { tag: 'LAUNCH', tone: '#A4B8CC', title: 'Launch announcement',
        body: 'Keystone is the workforce OS that actually follows through. From intake to credential to 365-day alumni follow-up — every operator, every employer, every grant on one canonical record.\n\nBook a demo → link in bio.' },
      { tag: 'OUTCOME', tone: '#00E47A', title: 'Outcome drop',
        body: '894 placements last quarter. 87.3% retention at 90 days. When the whole lifecycle lives in one system, outcomes stop slipping through the cracks.\n\nSee how → link in bio.' },
      { tag: 'FEATURE', tone: '#00C4E8', title: 'Mission control feature',
        body: 'Mission control for your whole program: live module telemetry, queue pressure, and uplink health — at a glance. Keystone shows you the state of everything, in one screen.' },
      { tag: 'COMMUNITY', tone: '#A4B8CC', title: 'Engagement prompt',
        body: 'Workforce directors: what’s the one number your funders ask for that’s hardest to pull? Tell us 👇 — we’ll show how Keystone surfaces it in one click.' },
    ],
    hashtags: {
      core: '#Keystone #WorkforceOS #WorkforceDevelopment',
      grants: '#WIOA #WorkforceGrants #DOL',
      partners: '#EmployerPartnership #JobPlacement',
      general: '#StudentSuccess #Outcomes #WorkforceTraining',
    },
    launch: {
      eyebrow: 'WORKFORCE OS · MISSION CONTROL',
      sqHeadline: 'THE WORKFORCE OS THAT FOLLOWS THROUGH.',
      sqSub: 'From intake to placement, credential to alumni — Keystone manages the full student lifecycle. Every module reports to one canonical record.',
      xHeadline: 'ONE RECORD. EVERY STAGE.',
      xSub: 'Keystone manages the full student lifecycle for training programs and workforce partners — intake to 365-day alumni follow-up.',
      liHeadline: 'THE WORKFORCE OS THAT FOLLOWS THROUGH.',
      liSub: 'From intake to placement, Keystone reconciles every operator, employer, and grant against one canonical record — built for case managers, not databases.',
      storyHeadline: 'INTAKE TO PLACEMENT, IN ONE SYSTEM.',
      storySub: 'The workforce OS that manages the full student lifecycle — and proves the outcome.',
      cta: 'Book a demo',
      metrics: [
        { label: 'PLACEMENTS · QTR', value: '894', color: '#00E47A' },
        { label: '90-DAY RETENTION', value: '87', unit: '%', color: '#00C4E8' },
        { label: 'LIFECYCLE STAGES', value: '7', color: '#A4B8CC' },
      ],
    },
    insight: {
      group: 'FIELD NOTE',
      sqHeadline: 'ONE OPERATOR. ONE RECORD. EVERY STAGE.',
      sqBody: 'Intake forms, attendance, case notes, credentials, placement, and alumni follow-up — all on one timeline. Nothing siloed, nothing lost.',
      storyHeadline: 'OUTCOMES DON’T SLIP WHEN NOTHING’S SILOED.',
      storyBody: 'When the whole lifecycle lives in one system, the numbers your funders ask for are already there — reconciled, traceable, one click away.',
      slotLabel: 'DROP TEAM / PROGRAM PHOTO',
    },
  },

  // ════════════════════════════════ SCRIPTA ══════════════════════════
  scripta: {
    id: 'scripta', name: 'SCRIPTA', theme: 'theme-scripta',
    accent: '#00C4E8', accent2: '#00E47A',
    handle: '@scripta.learn', domain: 'scripta.bioloopnexus.com',
    essence: 'Curriculum for every career — pre-built, assessed, certification-ready.',
    statusLabel: 'ARCHIVE ONLINE', statusTone: '#00E47A',
    accentName: 'SIGNAL CYAN + CLEAR GREEN',
    eyebrowMeta: 'OUTREACH · ASSET PACKAGE',
    palette: [
      { name: 'VOID', hex: '#050C14', dark: false },
      { name: 'SURFACE', hex: '#0D1E30', dark: false },
      { name: 'SIGNAL CYAN', hex: '#00C4E8', dark: true },
      { name: 'CLEAR GREEN', hex: '#00E47A', dark: true },
      { name: 'ALERT AMBER', hex: '#EFA020', dark: true },
      { name: 'TEXT', hex: '#C8DCF0', dark: true },
    ],
    voice: {
      register: 'Scholarly but accessible. Clarity and progression. Speak to learners and program admins alike.',
      do: ['“Twelve verticals. Zero setup.”', 'Celebrate progress: “1,887 certifications issued.”'],
      dont: ['Dry academic jargon.', 'Over-promising on “coming soon” packs.'],
    },
    captions: [
      { tag: 'LAUNCH', tone: '#00C4E8', title: 'Launch announcement',
        body: 'Scripta is live — pre-built curriculum for twelve workforce verticals. Lessons, assessments, and verifiable certification, ready to assign on day one. No authoring required.\n\nExplore the catalog → link in bio.' },
      { tag: 'VERTICAL', tone: '#00E47A', title: 'New vertical drop',
        body: 'New in the archive: Pharmacy Tech is live. 14 content packs, 312 units, fully assessed and certification-ready. Assign it to a cohort today.\n\n▶ link in bio.' },
      { tag: 'LESSON', tone: '#EFA020', title: 'Lesson tip (carousel intro)',
        body: 'LESSON 01 — Mastery beats completion.\n\nFinishing a module isn’t the same as owning it. Scripta scores against proctored assessments, so a certificate actually means something. ▶ Swipe.' },
      { tag: 'COMMUNITY', tone: '#00C4E8', title: 'Engagement prompt',
        body: 'Which workforce vertical should we build next? Drop it below 👇 — the top request goes straight into the Scripta test bay.' },
    ],
    hashtags: {
      core: '#Scripta #Curriculum #WorkforceTraining',
      verticals: '#PharmacyTech #CDL #Phlebotomy',
      general: '#OnlineLearning #CareerTraining #Upskilling',
      cert: '#Certification #CredentialingMatters',
    },
    launch: {
      eyebrow: 'KNOWLEDGE ARCHIVE · v4.2',
      sqHeadline: 'CURRICULUM FOR EVERY CAREER.',
      sqSub: 'Twelve workforce verticals, pre-built content packs, assessments, and certification — engineered to ship fast. No setup required.',
      xHeadline: 'CURRICULUM. NO SETUP REQUIRED.',
      xSub: 'Twelve workforce verticals, pre-built and assessment-ready — lessons, practice, and verifiable certification out of the box.',
      liHeadline: 'CURRICULUM FOR EVERY CAREER.',
      liSub: 'Scripta delivers pre-built, assessed, certification-ready curriculum across twelve workforce verticals — ready to assign on day one.',
      storyHeadline: 'TWELVE VERTICALS. ZERO SETUP.',
      storySub: 'Pre-built curriculum, assessments, and certification — ready to assign today.',
      cta: 'Explore the catalog',
      metrics: [
        { label: 'VERTICALS', value: '12', color: '#00C4E8' },
        { label: 'CONTENT PACKS', value: '238', color: '#EFA020' },
        { label: 'CERTS ISSUED', value: '1,887', color: '#00E47A' },
      ],
    },
    insight: {
      group: 'LESSON',
      sqHeadline: 'MASTERY BEATS COMPLETION.',
      sqBody: 'Finishing a module isn’t the same as owning it. Scripta scores against proctored assessments — so when the certificate prints, it actually means something.',
      storyHeadline: 'A CERTIFICATE SHOULD MEAN SOMETHING.',
      storyBody: 'Proctored, scored, verifiable. Scripta credentials are earned against real assessment — not a completion checkbox.',
      slotLabel: 'DROP LEARNER / CLASSROOM PHOTO',
    },
  },

  // ════════════════════════════════ DEMOFORGE ════════════════════════
  demoforge: {
    id: 'demoforge', name: 'DEMOFORGE', theme: 'theme-demoforge',
    accent: '#EFA020', accent2: '#E04040',
    handle: '@demoforge', domain: 'demoforge.bioloopnexus.com',
    essence: 'A synthetic media forge — automated demos and walkthroughs in minutes.',
    statusLabel: 'FORGE ONLINE', statusTone: '#00E47A',
    accentName: 'ALERT AMBER + STRIKE RED',
    eyebrowMeta: 'OUTREACH · ASSET PACKAGE',
    palette: [
      { name: 'VOID', hex: '#050C14', dark: false },
      { name: 'SURFACE', hex: '#0D1E30', dark: false },
      { name: 'ALERT AMBER', hex: '#EFA020', dark: true },
      { name: 'STRIKE RED', hex: '#E04040', dark: true },
      { name: 'SIGNAL CYAN', hex: '#00C4E8', dark: true },
      { name: 'TEXT', hex: '#C8DCF0', dark: true },
    ],
    voice: {
      register: 'Cinematic, generative, high-energy. Speak to teams who need demos fast — and show the magic.',
      do: ['“From script to screen in one render.”', 'Show the output, not the pipeline.'],
      dont: ['Over-technical “AI model” speak.', 'Hiding that the media is synthetic.'],
    },
    captions: [
      { tag: 'LAUNCH', tone: '#EFA020', title: 'Launch announcement',
        body: 'DemoForge is live. Type a script, pick a style, hit forge — and get a polished synthetic walkthrough in minutes, not days. Your product demos just got an unfair advantage.\n\nStart forging → link in bio.' },
      { tag: 'TAKE', tone: '#E04040', title: 'Take drop',
        body: 'TAKE 12, rendered. Same scene, four directions, zero reshoots. This is what “iterate at the speed of thought” actually looks like.\n\n▶ Watch → link in bio.' },
      { tag: 'HOW IT WORKS', tone: '#00C4E8', title: 'Process tip (carousel intro)',
        body: 'STEP 01 — Write the scene.\n\nDemoForge turns a plain-language script into camera moves, lighting, and narration. You direct; the forge renders. ▶ Swipe.' },
      { tag: 'COMMUNITY', tone: '#EFA020', title: 'Engagement prompt',
        body: 'Drop a product and a vibe in the comments 👇 — we’ll forge a 15-second demo concept and post the best one.' },
    ],
    hashtags: {
      core: '#DemoForge #SyntheticMedia #AIVideo',
      use: '#ProductDemo #DemoVideo #Walkthrough',
      general: '#GenerativeAI #ContentCreation #VideoProduction',
      team: '#MarketingTools #SalesEnablement',
    },
    launch: {
      eyebrow: 'SYNTHETIC MEDIA REACTOR',
      sqHeadline: 'SCRIPT IT. FORGE IT. SHIP IT.',
      sqSub: 'Automated demo generation — turn a plain-language script into a polished synthetic walkthrough in minutes, not days.',
      xHeadline: 'SCRIPT IT. FORGE IT. SHIP IT.',
      xSub: 'DemoForge turns a plain-language script into a polished synthetic walkthrough — camera, lighting, narration, rendered in minutes.',
      liHeadline: 'PRODUCT DEMOS, FORGED IN MINUTES.',
      liSub: 'DemoForge generates polished synthetic walkthroughs from a plain-language script — four directions, zero reshoots, ready to ship.',
      storyHeadline: 'FROM SCRIPT TO SCREEN IN ONE RENDER.',
      storySub: 'Type the scene. Pick a style. Hit forge. A polished demo, minutes later.',
      cta: 'Start forging',
      metrics: [
        { label: 'VARIATIONS / RUN', value: '4', color: '#EFA020' },
        { label: 'AVG RUNTIME', value: '0:18', color: '#E04040' },
        { label: 'TAKES TODAY', value: '12', color: '#00C4E8' },
      ],
    },
    insight: {
      group: 'FROM THE FORGE',
      sqHeadline: 'FOUR DIRECTIONS. ZERO RESHOOTS.',
      sqBody: 'Same scene, rendered four ways in the time it takes to brief a crew. Pick the winner, ship it, forge the next — no studio, no schedule.',
      storyHeadline: 'ITERATE AT THE SPEED OF THOUGHT.',
      storyBody: 'When a new take costs minutes instead of a shoot day, you stop guessing and start trying everything. That’s the unfair advantage.',
      slotLabel: 'DROP A GENERATED FRAME',
    },
  },

  // ════════════════════════════════ CRUCIBLE ═════════════════════════
  crucible: {
    id: 'crucible', name: 'CRUCIBLE', theme: 'theme-crucible',
    accent: '#E04040', accent2: '#EFA020',
    handle: '@crucible', domain: 'crucible.bioloopnexus.com',
    essence: 'A controlled chamber for stress-testing people and systems under pressure.',
    statusLabel: 'CHAMBER ARMED', statusTone: '#EFA020',
    accentName: 'STRIKE RED + ALERT AMBER',
    eyebrowMeta: 'OUTREACH · ASSET PACKAGE',
    palette: [
      { name: 'VOID', hex: '#050C14', dark: false },
      { name: 'SURFACE', hex: '#0D1E30', dark: false },
      { name: 'STRIKE RED', hex: '#E04040', dark: true },
      { name: 'ALERT AMBER', hex: '#EFA020', dark: true },
      { name: 'CLEAR GREEN', hex: '#00E47A', dark: true },
      { name: 'TEXT', hex: '#C8DCF0', dark: true },
    ],
    voice: {
      register: 'Intense but controlled, analytical. Pair tension with rigor and safety. Speak to teams validating under pressure.',
      do: ['“Find the breaking point before it finds you.”', 'Pair tension with control: “Monitored. Measured. Safe.”'],
      dont: ['Reckless “break things” bravado.', 'Fear without the payoff of resilience.'],
    },
    captions: [
      { tag: 'LAUNCH', tone: '#E04040', title: 'Launch announcement',
        body: 'Crucible is live. A controlled chamber for stress-testing people and systems under real pressure — monitored, measured, and safe. Find the breaking point before production does.\n\nRun a test → link in bio.' },
      { tag: 'RESULT', tone: '#EFA020', title: 'Result drop',
        body: 'Stress test complete. Peak load 91/100, resilience held, recovery in 02:14. You don’t know what holds until you test what doesn’t.\n\nSee the run → link in bio.' },
      { tag: 'PROTOCOL', tone: '#00E47A', title: 'Protocol tip (carousel intro)',
        body: 'PROTOCOL 01 — Pressure reveals, it doesn’t build.\n\nThe chamber doesn’t make you stronger; it shows you exactly where you bend. Then you train the gap. ▶ Swipe.' },
      { tag: 'COMMUNITY', tone: '#E04040', title: 'Engagement prompt',
        body: 'What’s the scenario you’re most afraid to simulate? Tell us 👇 — we’ll design a Crucible chamber around the top answer.' },
    ],
    hashtags: {
      core: '#Crucible #StressTesting #Resilience',
      use: '#SimulationTraining #LoadTesting #Preparedness',
      general: '#Reliability #SystemTesting #PerformanceUnderPressure',
      team: '#SRE #IncidentResponse',
    },
    launch: {
      eyebrow: 'CONTAINMENT CHAMBER · 04',
      sqHeadline: 'FIND THE BREAKING POINT FIRST.',
      sqSub: 'A controlled environment for stress-testing people and systems under real pressure — monitored, measured, safe.',
      xHeadline: 'FIND THE BREAKING POINT FIRST.',
      xSub: 'Crucible stress-tests people and systems under real, monitored pressure — so you meet the breaking point in the chamber, not in production.',
      liHeadline: 'STRESS-TEST BEFORE PRODUCTION DOES.',
      liSub: 'Crucible is a controlled chamber for validating resilience under real pressure — every run monitored, measured, and safe.',
      storyHeadline: 'KNOW WHAT HOLDS. AND WHAT DOESN’T.',
      storySub: 'A controlled chamber for stress-testing under real pressure. Monitored. Measured. Safe.',
      cta: 'Run a test',
      metrics: [
        { label: 'PEAK LOAD', value: '91', unit: '/100', color: '#E04040' },
        { label: 'RECOVERY', value: '2:14', color: '#EFA020' },
        { label: 'MONITORED', value: '100', unit: '%', color: '#00E47A' },
      ],
    },
    insight: {
      group: 'PROTOCOL',
      sqHeadline: 'PRESSURE REVEALS. IT DOESN’T BUILD.',
      sqBody: 'The chamber doesn’t make you stronger — it shows you exactly where you bend. Then you train the gap, and run it again.',
      storyHeadline: 'KNOW WHERE YOU BEND. THEN TRAIN IT.',
      storyBody: 'You don’t find out what holds until you test what doesn’t. Crucible makes failure safe — so the lesson lands in the lab, not the field.',
      slotLabel: 'DROP TEST / CHAMBER PHOTO',
    },
  },

  // ════════════════════════════════ VANTAGE ══════════════════════════
  vantage: {
    id: 'vantage', name: 'VANTAGE', theme: 'theme-vantage',
    accent: '#00C4E8', accent2: '#00E47A',
    handle: '@vantage', domain: 'vantage.bioloopnexus.com',
    essence: 'An autonomous signal reactor for advertising and content distribution.',
    statusLabel: 'AUTOPILOT', statusTone: '#00E47A',
    accentName: 'SIGNAL CYAN + CLEAR GREEN',
    eyebrowMeta: 'OUTREACH · ASSET PACKAGE',
    palette: [
      { name: 'VOID', hex: '#050C14', dark: false },
      { name: 'SURFACE', hex: '#0D1E30', dark: false },
      { name: 'SIGNAL CYAN', hex: '#00C4E8', dark: true },
      { name: 'CLEAR GREEN', hex: '#00E47A', dark: true },
      { name: 'ALERT AMBER', hex: '#EFA020', dark: true },
      { name: 'TEXT', hex: '#C8DCF0', dark: true },
    ],
    voice: {
      register: 'Predictive, adaptive, networked. Speak to growth and media teams — confident about automation, but always backed by numbers.',
      do: ['“Set the goal. Vantage finds the channel.”', 'Show the reallocation: “↑ TikTok +12%, ↓ Meta −8%.”'],
      dont: ['“Black box” mystique with no numbers.', 'Overclaiming “set and forget” with zero oversight.'],
    },
    captions: [
      { tag: 'LAUNCH', tone: '#00C4E8', title: 'Launch announcement',
        body: 'Vantage is live — an autonomous signal reactor for advertising and content distribution. Set your goal; it allocates spend across every channel, learns in real time, and rebalances on its own.\n\nPut your campaigns on autopilot → link in bio.' },
      { tag: 'SIGNAL', tone: '#00E47A', title: 'Optimization drop',
        body: 'Day 14: Vantage moved +12% to TikTok, +6% to YouTube, and pulled −8% off Meta — automatically, while you slept. 2.4M reach, $4.20 CPM and trending down.\n\nSee the network → link in bio.' },
      { tag: 'PLAYBOOK', tone: '#EFA020', title: 'Playbook tip (carousel intro)',
        body: 'SIGNAL 01 — The best channel is the one you haven’t tried yet.\n\nVantage tests, reads the response, and reallocates toward what’s working — continuously. You set the goal; it finds the path. ▶ Swipe.' },
      { tag: 'COMMUNITY', tone: '#00C4E8', title: 'Engagement prompt',
        body: 'If you could put one campaign on full autopilot tomorrow, which would it be? Tell us 👇 — we’ll break down exactly how Vantage would run it.' },
    ],
    hashtags: {
      core: '#Vantage #AdTech #MarketingAutomation',
      use: '#PaidMedia #CampaignOptimization #PerformanceMarketing',
      general: '#GrowthMarketing #MediaBuying #Programmatic',
      channels: '#TikTokAds #YouTubeAds',
    },
    launch: {
      eyebrow: 'SIGNAL REACTOR · AUTONOMOUS',
      sqHeadline: 'PUT YOUR CAMPAIGNS ON AUTOPILOT.',
      sqSub: 'An autonomous signal reactor that allocates spend across every channel, learns in real time, and rebalances on its own.',
      xHeadline: 'CAMPAIGNS ON AUTOPILOT.',
      xSub: 'Vantage allocates spend across every channel, reads the response, and rebalances in real time — autonomously, toward your goal.',
      liHeadline: 'AUTONOMOUS CONTENT DISTRIBUTION.',
      liSub: 'Vantage sets media strategy in motion — allocating spend across channels, learning from live performance, and rebalancing automatically toward your goal.',
      storyHeadline: 'PUT YOUR CAMPAIGNS ON AUTOPILOT.',
      storySub: 'An autonomous reactor that finds the channel, reads the signal, and rebalances — on its own.',
      cta: 'Launch a campaign',
      metrics: [
        { label: 'REACH', value: '2.4', unit: 'M', color: '#00C4E8' },
        { label: 'CONVERSIONS', value: '412', color: '#00E47A' },
        { label: 'CPM', value: '$4.20', color: '#EFA020' },
      ],
    },
    insight: {
      group: 'SIGNAL',
      sqHeadline: 'THE BEST CHANNEL IS THE ONE YOU HAVEN’T TRIED.',
      sqBody: 'Vantage tests, reads the response, and reallocates toward what’s working — continuously. You set the goal; it finds the path.',
      storyHeadline: 'OPTIMIZED WHILE YOU SLEPT.',
      storyBody: '+12% to TikTok, −8% off Meta — automatically, overnight. The reactor never stops reading the signal and moving spend toward the win.',
      slotLabel: 'DROP CAMPAIGN / NETWORK PHOTO',
    },
  },
}
