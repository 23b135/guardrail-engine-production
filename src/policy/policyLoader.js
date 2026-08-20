/**
 * Policy Loader with Inheritance
 * A base policy applies to all providers; a provider-specific overlay
 * can RESTRICT specific rules further (e.g. lower a toxicity threshold)
 * but can never RELAX the base policy (e.g. raise a threshold or remove
 * a rule). This is validated explicitly in mergeOverlay().
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const POLICIES_DIR = path.join(__dirname, '../../policies');

function loadYaml(relativePath) {
  const full = path.join(POLICIES_DIR, relativePath);
  return yaml.load(fs.readFileSync(full, 'utf8'));
}

/**
 * Fields where a LOWER number is stricter (so overlay may only decrease them).
 * Extend this map if you add new numeric rule fields.
 */
const STRICTER_MEANS_LOWER = new Set(['threshold']);

function mergeOverlay(basePolicy, overlay) {
  if (!overlay) return basePolicy;

  const merged = JSON.parse(JSON.stringify(basePolicy)); // deep clone
  const violations = [];

  for (const override of overlay.overrides || []) {
    const baseRule = merged.rules.find((r) => r.id === override.id);
    if (!baseRule) {
      violations.push(`Overlay references unknown rule id "${override.id}"`);
      continue;
    }

    for (const [field, newValue] of Object.entries(override)) {
      if (field === 'id') continue;

      if (STRICTER_MEANS_LOWER.has(field) && typeof newValue === 'number') {
        const baseValue = baseRule[field];
        if (typeof baseValue === 'number' && newValue > baseValue) {
          violations.push(
            `Overlay tried to RELAX rule "${override.id}": ${field} ${baseValue} -> ${newValue} is rejected (overlays may only restrict, never relax)`
          );
          continue; // reject this specific override, keep base value
        }
      }

      baseRule[field] = newValue;
    }
  }

  if (violations.length > 0) {
    merged._overlayViolations = violations;
  }
  merged._overlayApplied = overlay.name;

  return merged;
}

/**
 * Load the effective policy for a given provider: base policy + that
 * provider's overlay (if one exists). Falls back to base policy alone.
 */
function loadEffectivePolicy(providerName) {
  const basePolicy = loadYaml('base-policy.yaml');
  const overlayPath = `overlays/${providerName}-overlay.yaml`;
  const overlayFullPath = path.join(POLICIES_DIR, overlayPath);

  if (!fs.existsSync(overlayFullPath)) {
    return basePolicy;
  }

  const overlay = loadYaml(overlayPath);
  return mergeOverlay(basePolicy, overlay);
}

module.exports = { loadEffectivePolicy, mergeOverlay, loadYaml };
