import { HAIKU_SYSTEM, SONNET_SYSTEM, USER_MSG, buildFeedbackBlock, parseSections, orderSections } from '../lib/prompts.js';
import { readApprovedFeedback, logAnalysis } from '../lib/feedback-store.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  try {
    const { pdfText, fileName, fileSizeMb } = req.body;
    if (!pdfText || !pdfText.trim()) { res.status(400).json({ error: 'pdfText required' }); return; }

    const userContent = [{ type: 'text', text: `<pitch_book_text>\n${pdfText}\n</pitch_book_text>\n\n${USER_MSG}` }];

    // Only approved feedback rules go into the prompt
    const feedbackList = await readApprovedFeedback();
    const feedback = buildFeedbackBlock(feedbackList);

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    };

    const makeRequest = (model, systemPrompt) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: [{ type: 'text', text: systemPrompt + feedback, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    const [haikuRes, sonnetRes] = await Promise.all([
      makeRequest('claude-haiku-4-5-20251001', HAIKU_SYSTEM),
      makeRequest('claude-sonnet-4-20250514', SONNET_SYSTEM),
    ]);

    const [haikuData, sonnetData] = await Promise.all([
      haikuRes.json(),
      sonnetRes.json(),
    ]);

    const extractText = (data) => (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

    const haikuText = extractText(haikuData);
    const sonnetText = extractText(sonnetData);

    const haikuSections = parseSections(haikuText);
    const sonnetSections = parseSections(sonnetText);
    const all = { ...haikuSections, ...sonnetSections };
    const combined = orderSections(all);

    // Log the analysis to Supabase (non-blocking)
    logAnalysis({ fileName, analysisText: combined, fileSizeMb }).catch(() => {});

    res.status(200).json({ analysis: combined });

  } catch (err) {
    console.error('[analyze] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
