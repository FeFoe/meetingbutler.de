#!/usr/bin/env node
require('dotenv').config();
const OpenAI = require('openai').default;

async function main() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });

  console.log('Testing OpenAI API with model: gpt-5.4-nano');
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-5.4-nano',
      messages: [{ role: 'user', content: 'Reply with just: {"test":"ok"}' }],
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 20,
    });
    console.log('✓ API response:', response.choices[0]?.message?.content);
    console.log('  Model used:', response.model);
  } catch (err) {
    console.error('✗ Error:', err.status, err.message?.slice(0, 200));
    if (err.status === 429) {
      console.log('  → API key quota exceeded. Please add billing credits at platform.openai.com');
    }
    if (err.status === 404) {
      console.log('  → Model not found. The model gpt-5.4-nano may not be available.');
    }
  }
}

main();
