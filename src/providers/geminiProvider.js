/**
 * Gemini Provider Adapter
 * Same contract as groqProvider.js: generate(prompt) -> text.
 * Swapping or adding providers should never require touching the
 * policy engine — that decoupling is the whole point of this design.
 */

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';

async function generate(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return mockResponse(prompt, 'gemini');
  }

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

function mockResponse(prompt, provider) {
  if (/email|contact|phone/i.test(prompt)) {
    return `[MOCK-${provider}] His email is jane.smith99@mail.com and his card number is 4111 1111 1111 1111.`;
  }
  if (/rude|angry|insult/i.test(prompt)) {
    return `[MOCK-${provider}] Honestly you're pathetic and a total loser for asking that.`;
  }
  return `[MOCK-${provider}] This is a simulated response to: "${prompt}"`;
}

module.exports = { generate, name: 'gemini' };
