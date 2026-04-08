import { SONNET_SYSTEM, USER_MSG, buildFeedbackBlock } from '../lib/prompts.js';
import { readApprovedFeedback, logAnalysis } from '../lib/feedback-store.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  try {
    const { pdfText, fileName, fileSizeMb, userEmail, chunk } = req.body;
    if (!pdfText || !pdfText.trim()) { res.status(400).json({ error: 'pdfText required' }); return; }

    // Truncate to 120k chars max
    const trimmed = pdfText.slice(0, 120000);

    const feedbackList = await readApprovedFeedback();
    const feedback = buildFeedbackBlock(feedbackList);

    const systemPrompt = chunk === 2
      ? SONNET_SYSTEM + '\n\nNOTE: This is the second half of a large document. Focus on any details not covered in earlier pages. Do not repeat the Verdict — output only the Questions sections.'
      : SONNET_SYSTEM;

    const userContent = [{ type: 'text', text: `<pitch_book_text>\n${trimmed}\n</pitch_book_text>\n\n${USER_MSG}` }];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: [{ type: 'text', text: systemPrompt + feedback, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

    // Log analysis (only on primary chunk)
    if (chunk !== 2) {
      logAnalysis({ fileName, analysisText: text, fileSizeMb, userEmail }).catch(() => {});
    }

    res.status(200).json({ text });

  } catch (err) {
    console.error('[analyze-sonnet] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
