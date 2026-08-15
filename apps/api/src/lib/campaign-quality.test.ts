import { describe, expect, it } from 'vitest';
import { campaignVolume, similarityScore, validateFactSheet, validateFinalPayload } from './campaign-quality.js';

describe('campaign quality gate', () => {
  it('calculates Shift launch volume from daily targets', () => {
    expect(campaignVolume({ x: { daily: 2 }, linkedin: { daily: 1 }, reddit: { daily: 1 }, threads: { daily: 1 }, bluesky: { daily: 1 }, tiktok: { daily: 1 }, instagram: { daily: 1 }, facebook: { daily: 1 } }, 14)).toMatchObject({ posts_per_day: 9, total_pieces: 126 });
  });

  it('requires an approved campaign fact sheet', () => {
    expect(validateFactSheet({}).valid).toBe(false);
    expect(validateFactSheet({ approved_claims: ['Queue sequences practice'], prohibited_claims: ['guaranteed outcomes'], approved_terms: ['The Shift'], product_name: 'The Shift', primary_cta: 'Start a Queue deploy' }).valid).toBe(true);
  });

  it('validates the final tagged X payload rather than the pre-link draft', () => {
    expect(validateFinalPayload('x', { body: 'x'.repeat(281) }).valid).toBe(false);
  });

  it('detects duplicate campaign language', () => {
    expect(similarityScore('The Queue uses mastery signals to sequence practice.', ['The Queue uses mastery signals to sequence practice.'])).toBe(1);
  });
});
