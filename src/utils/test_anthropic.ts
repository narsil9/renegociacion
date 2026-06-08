import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Responde solo: API OK' }],
  });
  const text = response.content.find(b => b.type === 'text');
  console.log('✅ API funcional:', text?.type === 'text' ? text.text : '?');
  console.log('   Model:', response.model);
  console.log('   Tokens:', response.usage.input_tokens, 'in /', response.usage.output_tokens, 'out');
}

main().catch(e => console.error('❌ Error:', e.message));
