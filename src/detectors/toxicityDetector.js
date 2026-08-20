/**
 * Toxicity Detector
 * Lightweight keyword + pattern based scorer — zero cost, no external
 * classifier API required. Score is 0.0 (clean) to 1.0 (highly toxic).
 */

const TOXIC_TERMS = [
  'idiot', 'stupid', 'hate you', 'kill yourself', 'worthless',
  'shut up', 'moron', 'dumb', 'pathetic', 'trash', 'loser',
];

const SEVERE_TERMS = ['kill yourself', 'i hate you', 'worthless'];

function scoreToxicity(text) {
  const lower = text.toLowerCase();
  let hits = 0;
  let severeHits = 0;

  for (const term of TOXIC_TERMS) {
    if (lower.includes(term)) hits += 1;
  }
  for (const term of SEVERE_TERMS) {
    if (lower.includes(term)) severeHits += 1;
  }

  // Normalize: each mild hit = 0.35, each severe hit = 0.6, capped at 1.0
  const score = Math.min(1, hits * 0.35 + severeHits * 0.6);
  return { score: Number(score.toFixed(2)), hits, severeHits };
}

module.exports = { scoreToxicity };
