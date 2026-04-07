import { readFeedback, writeFeedback } from '../lib/feedback-store.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json(readFeedback());
  }

  if (req.method === 'POST') {
    try {
      const { text } = req.body;
      if (!text || !text.trim()) { return res.status(400).json({ error: 'text required' }); }

      // Use Claude to parse raw feedback into discrete rules
      const parseResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: 'You extract actionable analyst rules from user feedback about real estate LP deal analysis. Return ONLY a JSON array of strings — each string is one concise, imperative rule (e.g. "Flag when total deal-level fees exceed GP co-invest"). No numbering, no explanation, no markdown — just the JSON array.',
          messages: [{ role: 'user', content: text.trim() }],
        }),
      });

      const parseData = await parseResponse.json();
      const rawText = parseData.content?.find(b => b.type === 'text')?.text || '';
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      let rules;
      try { rules = JSON.parse(cleaned); } catch { rules = [text.trim()]; }
      if (!Array.isArray(rules) || rules.length === 0) rules = [text.trim()];

      const list = readFeedback();
      const date = new Date().toISOString().slice(0, 10);
      for (const rule of rules) { list.push({ text: String(rule).trim(), date }); }
      writeFeedback(list);
      return res.status(200).json(list);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { index } = req.body;
      const list = readFeedback();
      if (index >= 0 && index < list.length) { list.splice(index, 1); writeFeedback(list); }
      return res.status(200).json(list);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
}
