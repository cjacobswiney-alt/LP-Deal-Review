import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readAllFeedback, readApprovedFeedback, addFeedbackRules, deleteFeedbackRule, logAnalysis } from './lib/feedback-store.js'
import { HAIKU_SYSTEM, SONNET_SYSTEM, USER_MSG, buildFeedbackBlock, parseSections, orderSections } from './lib/prompts.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      {
        name: 'api-server',
        configureServer(server) {

          // --- /api/feedback ---
          server.middlewares.use('/api/feedback', (req, res, next) => {
            if (req.method === 'GET') {
              readAllFeedback().then(list => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(list));
              });
              return;
            }
            if (req.method === 'POST') {
              let body = '';
              req.on('data', chunk => body += chunk);
              req.on('end', async () => {
                try {
                  const { text } = JSON.parse(body);
                  if (!text || !text.trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'text required' })); return; }
                  const parseResponse = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({
                      model: 'claude-sonnet-4-20250514', max_tokens: 1024,
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
                  const list = await addFeedbackRules(rules);
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(list));
                } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err.message })); }
              });
              return;
            }
            if (req.method === 'DELETE') {
              let body = '';
              req.on('data', chunk => body += chunk);
              req.on('end', async () => {
                try {
                  const { id } = JSON.parse(body);
                  const list = await deleteFeedbackRule(id);
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(list));
                } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err.message })); }
              });
              return;
            }
            next();
          });

          // --- /api/analyze ---
          server.middlewares.use('/api/analyze', async (req, res) => {
            if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
              try {
                const { pdfText, fileName, fileSizeMb } = JSON.parse(body);
                if (!pdfText || !pdfText.trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'pdfText required' })); return; }

                const userContent = [{ type: 'text', text: `<pitch_book_text>\n${pdfText}\n</pitch_book_text>\n\n${USER_MSG}` }];

                const feedbackList = await readApprovedFeedback();
                const feedback = buildFeedbackBlock(feedbackList);

                const apiHeaders = {
                  'Content-Type': 'application/json',
                  'x-api-key': env.ANTHROPIC_API_KEY,
                  'anthropic-version': '2023-06-01',
                };

                const makeRequest = (model, systemPrompt) => fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: apiHeaders,
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

                const collectStream = async (response) => {
                  let text = '';
                  const reader = response.body.getReader();
                  const decoder = new TextDecoder();
                  let buffer = '';
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      buffer += decoder.decode();
                      for (const line of buffer.split('\n')) {
                        if (!line.startsWith('data: ')) continue;
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        try { const e = JSON.parse(data); if (e.type === 'content_block_delta' && e.delta?.text) text += e.delta.text; } catch {}
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
                      try { const e = JSON.parse(data); if (e.type === 'content_block_delta' && e.delta?.text) text += e.delta.text; } catch {}
                    }
                  }
                  return text;
                };

                const [haikuText, sonnetText] = await Promise.all([
                  collectStream(haikuRes),
                  collectStream(sonnetRes),
                ]);

                const haikuSections = parseSections(haikuText);
                const sonnetSections = parseSections(sonnetText);
                console.log('[analyze] Haiku sections:', Object.keys(haikuSections));
                console.log('[analyze] Sonnet sections:', Object.keys(sonnetSections));
                const all = { ...haikuSections, ...sonnetSections };
                const combined = orderSections(all);

                // Log analysis to Supabase (non-blocking)
                logAnalysis({ fileName, analysisText: combined, fileSizeMb }).catch(() => {});

                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                const chunkSize = 80;
                for (let i = 0; i < combined.length; i += chunkSize) {
                  const chunk = combined.slice(i, i + chunkSize);
                  res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
                  await new Promise(r => setTimeout(r, 15));
                }
                res.write('data: [DONE]\n\n');
                res.end();
              } catch (err) {
                console.error('[analyze] Error:', err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          });
        },
      },
    ],
  }
})
