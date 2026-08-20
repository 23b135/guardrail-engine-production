/**
 * Policy Engine
 * Loads a policy ONCE and applies it identically to output from any
 * provider. This module never imports groqProvider or geminiProvider —
 * it only ever sees plain text. That decoupling is what makes the
 * policy "provider-agnostic."
 */

const { redactPII } = require('../detectors/piiDetector');
const { scoreToxicity } = require('../detectors/toxicityDetector');
const { scoreTopicMatch } = require('../detectors/topicDetector');

/**
 * Evaluate a single provider's output against the loaded policy.
 * Returns a normalized result object — same shape no matter the provider.
 */
function evaluate(text, policy) {
  const violations = [];
  let finalOutput = text;
  let disposition = 'allow';

  for (const rule of policy.rules) {
    if (rule.check === 'pii') {
      const { redacted, findings } = redactPII(finalOutput);
      if (findings.length > 0) {
        violations.push({ rule: rule.id, check: 'pii', findings });
        if (rule.action === 'redact') {
          finalOutput = redacted;
          if (disposition === 'allow') disposition = 'redacted';
        } else if (rule.action === 'block') {
          disposition = 'blocked';
        }
      }
    }

    if (rule.check === 'toxicity') {
      const { score, hits, severeHits } = scoreToxicity(finalOutput);
      if (score >= (rule.threshold ?? 0.6)) {
        violations.push({ rule: rule.id, check: 'toxicity', score, hits, severeHits });
        if (rule.action === 'block') {
          disposition = 'blocked';
          finalOutput = '[BLOCKED: response withheld due to toxicity policy]';
        }
      }
    }

    if (rule.check === 'topic') {
      const { matched, matches } = scoreTopicMatch(finalOutput, rule.denied_topics || []);
      if (matched) {
        violations.push({ rule: rule.id, check: 'topic', matches });
        if (rule.action === 'block') {
          disposition = 'blocked';
          finalOutput = '[BLOCKED: response withheld due to denied topic policy]';
        }
      }
    }
  }

  return { finalOutput, disposition, violations };
}

module.exports = { evaluate };
