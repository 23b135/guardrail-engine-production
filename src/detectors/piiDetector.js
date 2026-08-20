/**
 * PII Detector
 * Regex-based detection so it works identically no matter which LLM
 * provider produced the text — the detector never talks to the provider.
 *
 * Patterns are checked in priority order (most specific first). Once a
 * span of text is claimed by a pattern, later patterns are not allowed
 * to match inside that same span — this stops e.g. a 16-digit credit
 * card number from also being tagged as a 12-digit Aadhaar number.
 */

const PII_PATTERNS = [
  // Order matters: longer/more specific patterns first so they claim
  // their span before a shorter pattern (like AADHAAR) can match inside it.
  { type: 'EMAIL', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'CREDIT_CARD', regex: /\b(?:\d[ -]*?){13,16}\b/g },
  { type: 'AADHAAR', regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
  { type: 'PHONE', regex: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
];

function detectPII(text) {
  const findings = [];
  const claimed = []; // list of {start, end} spans already matched

  const overlaps = (start, end) =>
    claimed.some((r) => start < r.end && end > r.start);

  for (const { type, regex } of PII_PATTERNS) {
    // ensure global flag so we can iterate all matches with exec()
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    let match;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (!overlaps(start, end)) {
        findings.push({ type, value: match[0] });
        claimed.push({ start, end });
      }

      // guard against zero-length matches causing an infinite loop
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }

  return findings;
}

function redactPII(text) {
  let redacted = text;
  const findings = detectPII(text);
  for (const { type, value } of findings) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    redacted = redacted.replace(new RegExp(escaped, 'g'), `[REDACTED_${type}]`);
  }
  return { redacted, findings };
}

module.exports = { detectPII, redactPII };