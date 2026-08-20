/**
 * Topic Denial Detector
 * Combines two signals, as required by the spec:
 *   1. Keyword matching — exact/substring overlap with denied topic phrases.
 *   2. Lightweight semantic similarity — cosine similarity over word-frequency
 *      vectors. This catches paraphrased/reworded matches that keyword
 *      matching alone would miss (e.g. "build a bomb" vs "make explosives"
 *      share no exact words but overlap semantically once you normalize
 *      and compare term vectors). It's embedding-free by design — no
 *      external model, no API cost, no compiler — but still gives a
 *      genuine similarity score beyond plain substring checks.
 */

const SYNONYM_GROUPS = [
  ['explosive', 'explosives', 'bomb', 'bombs', 'detonate', 'blast'],
  ['weapon', 'weapons', 'gun', 'firearm', 'ammunition'],
  ['harm', 'hurt', 'injure', 'kill', 'suicide', 'self-harm'],
  ['drug', 'drugs', 'narcotic', 'substance', 'synthesize', 'synthesis'],
  ['illegal', 'unlawful', 'prohibited', 'banned'],
  ['make', 'build', 'create', 'construct', 'manufacture'],
];

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function expandSynonyms(word) {
  const group = SYNONYM_GROUPS.find((g) => g.includes(word));
  return group || [word];
}

function toVector(words) {
  const vec = {};
  for (const w of words) {
    for (const syn of expandSynonyms(w)) {
      vec[syn] = (vec[syn] || 0) + 1;
    }
  }
  return vec;
}

function cosineSimilarity(vecA, vecB) {
  const keys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
  let dot = 0, magA = 0, magB = 0;
  for (const k of keys) {
    const a = vecA[k] || 0;
    const b = vecB[k] || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function scoreTopicMatch(text, deniedTopics = []) {
  const textWords = normalize(text);
  const textVec = toVector(textWords);
  const lowerText = text.toLowerCase();
  const matches = [];

  for (const topic of deniedTopics) {
    // Signal 1: keyword / substring overlap
    const topicWords = normalize(topic);
    const keywordHits = topicWords.filter((w) => lowerText.includes(w)).length;
    const keywordOverlap = topicWords.length ? keywordHits / topicWords.length : 0;

    // Signal 2: semantic similarity via synonym-expanded cosine similarity
    const topicVec = toVector(topicWords);
    const semanticScore = cosineSimilarity(textVec, topicVec);

    // Combined score: either strong keyword overlap OR strong semantic similarity
    const combinedScore = Math.max(keywordOverlap, semanticScore);

    if (combinedScore >= 0.5) {
      matches.push({
        topic,
        keywordOverlap: Number(keywordOverlap.toFixed(2)),
        semanticScore: Number(semanticScore.toFixed(2)),
        combinedScore: Number(combinedScore.toFixed(2)),
      });
    }
  }

  return { matched: matches.length > 0, matches };
}

module.exports = { scoreTopicMatch };
