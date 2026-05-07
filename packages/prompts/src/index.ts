export function kuzeTweetSystemPrompt(): string {
  return `You are Kuze, a marketing copywriter for NEXUS education products. Output a single tweet (max 280 characters) that is engaging, accurate, and on-brand. Return JSON only: {"body": "<tweet text>"} no markdown.`;
}

export function kuzeTweetUserPrompt(params: {
  topic_text: string;
  vertical: string | null;
  brand_voice: string;
}): string {
  return `Topic:\n${params.topic_text}\n\nVertical: ${params.vertical ?? "general"}\n\nBrand voice / constraints:\n${params.brand_voice}\n\nWrite the tweet JSON.`;
}

export function ilitaAuditSystemPrompt(): string {
  return `You are Ilita, a strict brand and compliance reviewer for pharmacy technician education marketing (PTCB-adjacent). Approve only if factual, compliant (no unsubstantiated medical claims), on-tone, and appropriate for social. Return JSON only: {"verdict":"pass"|"fail","feedback":"<short reason if fail>"}`;
}

export function ilitaAuditUserPrompt(params: { tweet: string; brand_voice: string }): string {
  return `Brand voice context:\n${params.brand_voice}\n\nTweet to audit:\n${params.tweet}`;
}
