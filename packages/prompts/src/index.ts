// ── Channel → format mapping ──────────────────────────────────────────────────
export const channelFormatMap = {
  x:         'tweet',
  linkedin:  'linkedin_post',
  reddit:    'reddit_thread',
  threads:   'threads_post',
  bluesky:   'bluesky_post',
  email:     'email_newsletter',
  tiktok:    'tiktok_script',
  instagram: 'instagram_caption',
  facebook:  'facebook_post',
} as const

export type ChannelSlug = keyof typeof channelFormatMap
export type ContentFormat = typeof channelFormatMap[ChannelSlug]

// ── Kuze — unified generation ─────────────────────────────────────────────────

/** Shape of the `brand_voice` row, as serialized by the API before it reaches a prompt. */
export interface BrandVoiceShape {
  name?: string
  description?: string
  per_channel_tone?: Record<string, string>
  off_topics?: string[]
}

export function parseBrandVoice(raw: string | null | undefined): BrandVoiceShape | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as BrandVoiceShape
  } catch {
    return null
  }
}

/**
 * Render the brand voice for a prompt, selecting **only** the target channel's tone.
 *
 * The whole `per_channel_tone` object used to be stringified into the prompt, so
 * the model received all nine channels' instructions as raw JSON and had to pick
 * the right one out of the noise. Handing it the one that applies is the single
 * biggest lever on adherence.
 */
export function renderBrandVoice(raw: string | null | undefined, channel?: string): string {
  const voice = parseBrandVoice(raw)
  if (!voice) return raw ? String(raw) : ''

  const parts: string[] = []
  if (voice.name) parts.push(`Brand: ${voice.name}`)
  if (voice.description) parts.push(`Voice:\n${voice.description}`)

  const tone = channel && voice.per_channel_tone ? voice.per_channel_tone[channel] : undefined
  if (tone) parts.push(`Tone for this channel (${channel}) — this governs:\n${tone}`)

  if (voice.off_topics?.length) {
    parts.push(`Never write about:\n${voice.off_topics.map((t) => `- ${t}`).join('\n')}`)
  }
  return parts.join('\n\n')
}

export function kuzeSystemPrompt(
  format: ContentFormat,
  opts?: { brandVoice?: string; channel?: string },
): string {
  const voiceBlock = renderBrandVoice(opts?.brandVoice, opts?.channel)

  // The brand identity is *configured*, not hard-coded. This prompt previously
  // asserted NEXUS was "a suite of online certification prep products" with
  // "education-first energy" — a different product and a different register from
  // the operator's actual brand voice. Being in the system prompt, that fiction
  // outranked the real configuration and is what produced the generic SaaS copy
  // the audit kept rejecting.
  const base = `You are Kuze, a marketing copywriter. You write content that promotes real products to real people, in the specific voice of the brand described below.

${voiceBlock ? `${voiceBlock}\n\n` : ''}Precedence — read carefully:
1. The brand voice and channel tone above are AUTHORITATIVE. They override every default in this prompt.
2. The output schema below is a hard requirement — field names and character limits are not negotiable.
3. The structural defaults below apply ONLY where the brand voice is silent. Where they conflict, the brand voice wins.

Never write copy that could belong to any other company. If a sentence would survive a find-and-replace of the product name, it is too generic — rewrite it with something only this brand could say.

Reject your own first instinct toward: motivational openers, "transform/unlock/say goodbye to", "seamless", "innovative", "excited to announce", "imagine a world/system where", engagement-bait questions, and any benefit promise you cannot substantiate. These are the failure modes the compliance reviewer rejects most often.

Be accurate — never exaggerate outcomes, never invent product features, never make unsubstantiated claims.

You must return ONLY valid JSON — no markdown, no code fences, no preamble. Escape every double quote and newline inside string values. Exact schema for this format below:`

  const schemas: Record<ContentFormat, string> = {
    tweet: `
Format: tweet
Output schema: {"body":"<tweet text, max 280 chars>"}
Structural defaults (yield to brand voice): Front-load the substance. Max 2 hashtags. CTA optional. Count characters.`,

    linkedin_post: `
Format: linkedin_post
Output schema: {"body":"<post text, 150–1200 chars>","headline":"<optional 6–10 word hook for first line>"}
Structural defaults (yield to brand voice): Use short paragraphs and line breaks for readability. No emoji spam. One clear argument per post.`,

    reddit_thread: `
Format: reddit_thread
Output schema: {"title":"<post title, max 300 chars>","body":"<post body, 100–800 words>","is_link_post":false}
Structural defaults (yield to brand voice): Value-first — teach something useful. Never a direct ad. Subreddit context is provided in the prompt. No self-promotion in the title.`,

    threads_post: `
Format: threads_post
Output schema: {"body":"<post text, max 500 chars>"}
Structural defaults (yield to brand voice): Lead the first line with the substance. Max 1–2 hashtags. Count characters.`,

    bluesky_post: `
Format: bluesky_post
Output schema: {"body":"<post text, max 300 chars>"}
Structural defaults (yield to brand voice): This audience skews technical and dislikes marketing-speak. Lead with the useful idea. No hashtag spam. Count characters (300 hard limit).`,

    email_newsletter: `
Format: email_newsletter
Output schema: {"subject":"<email subject line, 6–12 words>","preview_text":"<preview/preheader, max 100 chars>","body":"<HTML email body>"}
Structural defaults (yield to brand voice): Subject says exactly what is inside, never clickbait. Body uses simple HTML: <p>, <h2>, <ul>, <li>, <a href="...">. Include a clear CTA anchor. 300–700 words.`,

    tiktok_script: `
Format: tiktok_script
Output schema: {"hook":"<first spoken sentence, max 10 words — must stop the scroll>","body":"<full narration script, spoken word, 45–60 seconds at normal pace>","on_screen_text":"<key phrases to display on screen>"}
Structural defaults (yield to brand voice): Write as spoken word — short sentences, contractions, natural rhythm. The hook must land within the first 2–3 seconds of audio. End with a direct verbal close.`,

    instagram_caption: `
Format: instagram_caption
Output schema: {"body":"<caption text, 100–400 chars before hashtags>","hashtags":["<tag without #>"],"alt_text":"<image alt text for accessibility>"}
Structural defaults (yield to brand voice): The first line must land on its own (it shows before “more”). 5–15 hashtags, mix of niche and broad. Alt text describes what the paired image would show.`,

    facebook_post: `
Format: facebook_post
Output schema: {"body":"<post text, 100–500 chars>"}
Structural defaults (yield to brand voice): Accessible register — more context than X, less formal than LinkedIn. Avoid hard sell. One clear CTA at the end.`,
  }

  return `${base}\n${schemas[format]}`
}

// ── BioLoop pattern key → human-readable instruction ─────────────────────────
// Keeps prompt guidance legible for the model. Keys must match extractPatterns()
// in supabase/functions/bioloop/index.ts.
const PATTERN_INSTRUCTIONS: Record<string, string> = {
  // Length
  length_short:            'keep the content concise — under 150 characters in the body',
  length_medium:           'aim for a medium-length body — 150–400 characters',
  length_long:             'write a longer, more detailed body — over 400 characters',
  // Structural
  has_question:            'include at least one direct question to the reader',
  has_cta:                 'include a clear, natural call-to-action (try, join, learn, sign up, etc.)',
  has_numbers:             'anchor the content with a specific number, stat, or percentage',
  has_hashtags:            'include relevant hashtags',
  // Openers
  opener_emotional:        'open with an emotional hook — "imagine", "what if", "ever wonder", "did you know", etc.',
  opener_question:         'open with a direct question as the very first line',
  opener_number:           'open with a number or statistic as the very first word or phrase',
  // Format-specific
  tweet_punchy:            'keep the tweet under 120 characters — punchy and self-contained',
  linkedin_has_headline:   'include a bold headline field as a standalone first-line hook',
  email_has_preview_text:  'include a compelling preview_text field (shown in inbox before opening)',
  tiktok_strong_hook:      'write a very strong hook field — it must stop a scroll in under 3 seconds',
  reddit_concise_title:    'keep the Reddit post title under 80 characters',
  instagram_hashtag_rich:  'include at least 5 targeted hashtags',
  // Angles
  angle_how_to:            'frame the content as a how-to, step-by-step guide, or tip',
  angle_data_driven:       'anchor the content in data, a published study, research, or a survey',
  angle_personal_story:    'use a first-person or personal-story framing ("when I", "my", "I learned")',
}

function weightsToInstructions(raw: string): string {
  // raw format from loadWeights(): "pattern_key: 1.52 (n=14)\n..."
  const lines = raw.trim().split('\n')
  const instructions: string[] = []
  for (const line of lines) {
    const match = line.match(/^(\S+):\s*([\d.]+)\s*\(n=(\d+)\)/)
    if (!match) continue
    const [, key, weight, n] = match
    const instruction = PATTERN_INSTRUCTIONS[key]
    if (instruction) {
      instructions.push(`- ${instruction}  [${parseFloat(weight).toFixed(2)}× lift, n=${n}]`)
    }
  }
  return instructions.join('\n')
}

function avoidWeightsToInstructions(raw: string): string {
  // raw format from loadUnderperformingWeights(): "pattern_key: 0.62 (n=9)\n..."
  const lines = raw.trim().split('\n')
  const instructions: string[] = []
  for (const line of lines) {
    const match = line.match(/^(\S+):\s*([\d.]+)\s*\(n=(\d+)\)/)
    if (!match) continue
    const [, key, weight, n] = match
    const instruction = PATTERN_INSTRUCTIONS[key]
    if (instruction) {
      // Labeled as a directive rather than grammatically negating the (positively-phrased)
      // PATTERN_INSTRUCTIONS text, since prefixing "avoid " onto an imperative like "keep the
      // content concise" doesn't parse as a negation. "AVOID —" as a label reads correctly
      // regardless of the source phrase's verb form.
      instructions.push(`- AVOID — this pattern underperforms: ${instruction}  [${parseFloat(weight).toFixed(2)}× lift, n=${n}]`)
    }
  }
  return instructions.join('\n')
}

const REJECTION_CATEGORY_INSTRUCTIONS: Record<IlitaRejectionCategory, string> = {
  unsubstantiated_claim:    'making unsubstantiated medical, legal, or pass-rate claims',
  competitor_mention:       'mentioning competitor brands',
  discount_first_language:  'leading with aggressive discount-first language',
  off_topic:                'touching the operator-specified off-topics',
  inaccurate_product_claim: 'inventing or misrepresenting NEXUS product features',
  audience_mismatch:        'content inappropriate for the target professional audience',
  format_violation:         "violating this format's structural rules (length limits, hook placement, etc.)",
  other:                    'issues previously flagged on this channel',
}

function rejectionCategoriesToInstructions(raw: string): string {
  // raw format from loadRejectionCategories(): "category_key: 4\n..."
  const lines = raw.trim().split('\n')
  const instructions: string[] = []
  for (const line of lines) {
    const match = line.match(/^(\S+):\s*(\d+)/)
    if (!match) continue
    const [, key, count] = match
    const instruction = REJECTION_CATEGORY_INSTRUCTIONS[key as IlitaRejectionCategory]
    if (instruction) {
      instructions.push(`- AVOID — ${instruction}  [${count}× rejected recently]`)
    }
  }
  return instructions.join('\n')
}

export interface ViralityPatternExtra {
  pattern_name: string
  pattern_description?: string | null
  characteristics?: Record<string, unknown> | null
  reproduction_success_rate?: number | null
  confidence_score?: number | null
  sample_size?: number | null
}

function viralityPatternsToInstructions(patterns: ViralityPatternExtra[]): string {
  const lines: string[] = []
  for (const p of patterns) {
    const c = (p.characteristics ?? {}) as {
      format?: string; hooks?: string[] | string; tone?: string
      length?: string; call_to_action?: string; timing?: string
    }
    const bits: string[] = []
    if (c.format) bits.push(`format: ${c.format}`)
    if (c.hooks) bits.push(`hooks: ${Array.isArray(c.hooks) ? c.hooks.join(', ') : c.hooks}`)
    if (c.tone) bits.push(`tone: ${c.tone}`)
    if (c.length) bits.push(`length: ${c.length}`)
    if (c.call_to_action) bits.push(`CTA style: ${c.call_to_action}`)
    if (c.timing) bits.push(`timing: ${c.timing}`)
    const detail = bits.length ? ` (${bits.join('; ')})` : ''
    const rate = p.reproduction_success_rate != null ? `${Math.round(p.reproduction_success_rate * 100)}% reproduction rate` : null
    const conf = p.confidence_score != null ? `confidence ${p.confidence_score.toFixed(2)}` : null
    const stats = [rate, conf].filter(Boolean).join(', ')
    lines.push(`- ${p.pattern_name}${detail}${stats ? `  [${stats}]` : ''}`)
  }
  return lines.join('\n')
}

export function kuzeUserPrompt(params: {
  format: ContentFormat
  topic_text: string
  vertical: string | null
  brand_voice: string
  channel?: string
  extras?: {
    subreddit?: string
    weights?: string
    avoidWeights?: string
    viralityPatterns?: ViralityPatternExtra[]
    rejectionCategories?: string
  }
}): string {
  const parts: string[] = []
  parts.push(`Topic:\n${params.topic_text}`)
  parts.push(`Vertical: ${params.vertical ?? 'general'}`)

  // The brand voice now leads the system prompt. Repeating the channel tone here
  // — rather than restating the whole JSON blob mid-prompt, competing with the
  // performance-weight and virality sections — keeps it adjacent to the topic it
  // has to govern.
  const channelTone = parseBrandVoice(params.brand_voice)?.per_channel_tone?.[params.channel ?? '']
  if (channelTone) {
    parts.push(`Reminder — the tone this channel requires:\n${channelTone}`)
  } else if (!parseBrandVoice(params.brand_voice)) {
    // Unparseable brand voice: pass it through rather than dropping it silently.
    parts.push(`Brand voice / constraints:\n${params.brand_voice}`)
  }

  if (params.extras?.subreddit) {
    parts.push(`Target subreddit: r/${params.extras.subreddit}`)
  }
  if (params.extras?.weights) {
    const instructions = weightsToInstructions(params.extras.weights)
    if (instructions) {
      parts.push(
        `High-performing content patterns (ranked by engagement lift — apply as many as naturally fit):\n${instructions}`
      )
    }
  }
  if (params.extras?.viralityPatterns?.length) {
    const patternText = viralityPatternsToInstructions(params.extras.viralityPatterns)
    if (patternText) {
      parts.push(
        `Proven viral patterns for this channel (draw on these characteristics where they fit naturally):\n${patternText}`
      )
    }
  }
  if (params.extras?.avoidWeights) {
    const avoidInstructions = avoidWeightsToInstructions(params.extras.avoidWeights)
    if (avoidInstructions) {
      parts.push(
        `Underperforming patterns — avoid these:\n${avoidInstructions}`
      )
    }
  }
  if (params.extras?.rejectionCategories) {
    const rejectionInstructions = rejectionCategoriesToInstructions(params.extras.rejectionCategories)
    if (rejectionInstructions) {
      parts.push(
        `Ilita has recently rejected content on this channel for these reasons — avoid repeating them:\n${rejectionInstructions}`
      )
    }
  }

  parts.push(`Generate the ${params.format} JSON now.`)
  return parts.join('\n\n')
}

// ── Ilita — format-aware audit ────────────────────────────────────────────────

// Rejection category — mirrors the "Universal compliance rules" below so aggregation
// (see kuze.ts's loadRejectionCategories()) can turn repeated failures into avoid-list
// guidance for future generations, without re-parsing freeform feedback text.
export const ILITA_REJECTION_CATEGORIES = [
  'unsubstantiated_claim',
  'competitor_mention',
  'discount_first_language',
  'off_topic',
  'inaccurate_product_claim',
  'audience_mismatch',
  'format_violation',
  'other',
] as const
export type IlitaRejectionCategory = typeof ILITA_REJECTION_CATEGORIES[number]

export function ilitaAuditSystemPrompt(format: ContentFormat): string {
  const rules: Record<ContentFormat, string> = {
    tweet: 'Tweet (max 280 chars): verify character count, hook quality, brand compliance.',
    linkedin_post: 'LinkedIn post: verify professional tone, accuracy of any statistics cited, no unsubstantiated claims.',
    reddit_thread: 'Reddit thread: verify value-first framing, no overt advertising, subreddit-appropriate tone.',
    threads_post: 'Threads post (max 500 chars): verify character count, conversational hook, minimal hashtags, brand compliance.',
    bluesky_post: 'Bluesky post (max 300 chars): verify character count, authentic non-markety tone, no hashtag spam, brand compliance.',
    email_newsletter: 'Email newsletter: verify subject line is not clickbait, HTML is well-formed, CTA is present and honest.',
    tiktok_script: 'TikTok script: verify hook lands in ≤3 seconds, pacing is natural for spoken word, CTA is verbal and clear.',
    instagram_caption: 'Instagram caption: verify hook is in first line, hashtags are relevant and not spammy, alt text is descriptive.',
    facebook_post: 'Facebook post: verify community tone, question or engagement hook is present, no hard sell.',
  }

  return `You are Ilita, a strict brand and compliance reviewer for NEXUS education product marketing.

Your role: review generated content and return a pass or fail verdict.

Universal compliance rules (apply to ALL formats):
- No unsubstantiated medical, legal, or pass-rate claims
- No competitor brand mentions
- No aggressive discount-first language
- No content that touches the operator-specified off-topics
- Must accurately represent NEXUS products (do not invent features)
- Must be appropriate for the target professional audience

Format-specific rules for this review:
${rules[format]}

Return ONLY valid JSON: {"verdict":"pass"|"fail","feedback":"<1-2 sentences — required on fail, optional encouragement on pass>","category":"<on fail only, one of: ${ILITA_REJECTION_CATEGORIES.join('|')} — omit entirely on pass>"}
No markdown, no preamble.`
}

export function ilitaAuditUserPrompt(params: {
  content: string
  format: ContentFormat
  brand_voice: string
}): string {
  return `Brand voice / off-topics context:\n${params.brand_voice}\n\nContent to audit (${params.format}):\n${params.content}`
}

// ── Legacy exports — kept for backwards compat ────────────────────────────────

export function kuzeTweetSystemPrompt(): string {
  return kuzeSystemPrompt('tweet')
}

export function kuzeTweetUserPrompt(params: {
  topic_text: string
  vertical: string | null
  brand_voice: string
}): string {
  return kuzeUserPrompt({ format: 'tweet', ...params })
}

export function ilitaAuditSystemPrompt_v0(): string {
  return ilitaAuditSystemPrompt('tweet')
}

export function ilitaAuditUserPrompt_v0(params: { tweet: string; brand_voice: string }): string {
  return ilitaAuditUserPrompt({ content: params.tweet, format: 'tweet', brand_voice: params.brand_voice })
}
