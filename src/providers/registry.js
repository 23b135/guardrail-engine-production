/**
 * Provider Registry
 * To add a third provider (e.g., OpenAI, Claude), you only add a new
 * file in /providers with a generate(prompt) function and register it
 * here. Nothing in the policy engine or server routes changes.
 */

const groq = require('./groqProvider');
const gemini = require('./geminiProvider');

const registry = {
  groq,
  gemini,
};

function getProvider(name) {
  const provider = registry[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(registry).join(', ')}`);
  }
  return provider;
}

function listProviders() {
  return Object.keys(registry);
}

module.exports = { getProvider, listProviders };
