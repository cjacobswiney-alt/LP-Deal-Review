import { HAIKU_SYSTEM, USER_MSG, buildFeedbackBlock } from '../lib/prompts.js';
import { readApprovedFeedback } from '../lib/feedback-store.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  try {
    const { pdfText } = req.body;
    if (!pdfText || !pdfText.trim()) { res.status(400).json({ error: 'pdfText required' }); return; }

    const userContent = [{ type: 'text', text: `<pitch_book_text>\n${pdfText}\n</pitch_book_text>\n\n${USER_MSG}` }];

    const feedbackList = await readApprovedFeedback();
    const feedback = buildFeedbackBlock(feedbackList);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        system: [{ type: 'text', text: HAIKU_SYSTEM + feedback, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }],
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
