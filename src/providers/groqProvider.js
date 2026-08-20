/**
 * Groq Provider Adapter
 * Normalizes Groq's chat completion API into a single generate(prompt)
 * function so the policy engine never needs to know provider details.
 * Falls back to a mock response if no API key is set, so the whole
 * system is testable with zero cost / zero keys.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function generate(prompt) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return mockResponse(prompt, 'groq');
  }

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

function mockResponse(prompt, provider) {
  // Deterministic mock so the pipeline is fully demonstrable without a key.
  if (/email|contact|phone/i.test(prompt)) {
    return `[MOCK-${provider}] Sure, you can reach John at john.doe@example.com or call him at 987-654-3210.`;
  }
  if (/rude|angry|insult/i.test(prompt)) {
    return `[MOCK-${provider}] You're being an idiot, honestly, shut up and figure it out yourself.`;
  }
  return `[MOCK-${provider}] This is a simulated response to: "${prompt}"`;
}

module.exports = { generate, name: 'groq' };
