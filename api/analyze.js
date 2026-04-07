import { HAIKU_SYSTEM, SONNET_SYSTEM, USER_MSG, buildFeedbackBlock, parseSections, orderSections } from '../lib/prompts.js';
import { readFeedback } from '../lib/feedback-store.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  try {
    const { pdfBase64 } = req.body;
    if (!pdfBase64) { res.status(400).json({ error: 'pdfBase64 required' }); return; }

    // --- Step 1: Extract text from PDF ---
    let pdfText = '';
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const buffer = Buffer.from(pdfBase64, 'base64');
      const parsed = await pdfParse(buffer);
      pdfText = parsed.text || '';
    } catch (e) {
      console.log('[analyze] PDF text extraction failed, falling back to document mode:', e.message);
    }

    const useTextMode = pdfText.trim().length > 500;
    const userContent = useTextMode
      ? [{ type: 'text', text: `<pitch_book_text>\n${pdfText}\n</pitch_book_text>\n\n${USER_MSG}` }]
      : [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: USER_MSG },
        ];

    const feedbackList = readFeedback();
    const feedback = buildFeedbackBlock(feedbackList);

    // --- Step 2: Fire Haiku + Sonnet in parallel ---
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
        stream: true,
      }),
    });

    const [haikuRes, sonnetRes] = await Promise.all([
      makeRequest('claude-haiku-4-5-20251001', HAIKU_SYSTEM),
      makeRequest('claude-sonnet-4-20250514', SONNET_SYSTEM),
    ]);

    // --- Step 3: Collect both streams ---
    const collectStream = async (response) => {
      let text = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          const remaining = buffer.split('\n');
          for (const line of remaining) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const event = JSON.parse(data);
              if (event.type === 'content_block_delta' && event.delta?.text) text += event.delta.text;
            } catch {}
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            if (event.type === 'content_block_delta' && event.delta?.text) text += event.delta.text;
          } catch {}
        }
      }
      return text;
    };

    const [haikuText, sonnetText] = await Promise.all([
      collectStream(haikuRes),
      collectStream(sonnetRes),
    ]);

    // --- Step 4: Parse and reassemble ---
    const haikuSections = parseSections(haikuText);
    const sonnetSections = parseSections(sonnetText);
    const all = { ...haikuSections, ...sonnetSections };
    const combined = orderSections(all);

    // --- Step 5: Stream to frontend ---
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const chunkSize = 80;
    for (let i = 0; i < combined.length; i += chunkSize) {
      const chunk = combined.slice(i, i + chunkSize);
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('[analyze] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
