import { HAIKU_SYSTEM, USER_MSG } from '../lib/prompts.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  try {
    const { pdfText } = req.body;
    if (!pdfText || !pdfText.trim()) { res.status(400).json({ error: 'pdfText required' }); return; }

    // Truncate text to ~80k chars (~20k tokens) to keep response fast
    const trimmed = pdfText.slice(0, 80000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: HAIKU_SYSTEM,
        messages: [{ role: 'user', content: `<pitch_book_text>\n${trimmed}\n</pitch_book_text>\n\n${USER_MSG}` }],
      }),
    });

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    res.status(200).json({ text });

  } catch (err) {
    console.error('[analyze-haiku] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
