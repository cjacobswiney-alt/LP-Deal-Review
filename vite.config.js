import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readAllFeedback, readApprovedFeedback, addFeedbackRules, deleteFeedbackRule, logAnalysis } from './lib/feedback-store.js'
import { HAIKU_SYSTEM, SONNET_SYSTEM, DOCS_SYSTEM, USER_MSG, DOCS_USER_MSG, buildFeedbackBlock, parseSections, orderSections } from './lib/prompts.js'
import { supabase } from './lib/supabase.js'

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

          // --- /api/register ---
          server.middlewares.use('/api/register', (req, res, next) => {
            if (req.method !== 'POST') { next(); return; }
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
              try {
                const { email, name, company } = JSON.parse(body);
                if (!email || !email.trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'email required' })); return; }
                const { error } = await supabase
                  .from('app_users')
                  .upsert({ email: email.trim().toLowerCase(), name: name?.trim() || null, company: company?.trim() || null }, { onConflict: 'email' });
                if (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); return; }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
              } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err.message })); }
            });
          });

          // --- /api/analyze-haiku ---
          server.middlewares.use('/api/analyze-haiku', async (req, res) => {
            if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
              try {
                const { pdfText } = JSON.parse(body);
                if (!pdfText || !pdfText.trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'pdfText required' })); return; }
                const userContent = [{ type: 'text', text: `<pitch_book_text>\n${pdfText}\n</pitch_book_text>\n\n${USER_MSG}` }];
                const feedbackList = await readApprovedFeedback();
                const feedback = buildFeedbackBlock(feedbackList);
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                  body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8192,
                    system: [{ type: 'text', text: HAIKU_SYSTEM + feedback, cache_control: { type: 'ephemeral' } }],
                    messages: [{ role: 'user', content: userContent }] }),
                });
                const data = await response.json();
                const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ text }));
              } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err.message })); }
            });
          });

          // --- /api/analyze-sonnet ---
          server.middlewares.use('/api/analyze-sonnet', async (req, res) => {
            if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
              try {
                const { pdfText, fileName, fileSizeMb, userEmail } = JSON.parse(body);
                if (!pdfText || !pdfText.trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'pdfText required' })); return; }
                const userContent = [{ type: 'text', text: `<pitch_book_text>\n${pdfText}\n</pitch_book_text>\n\n${USER_MSG}` }];
                const feedbackList = await readApprovedFeedback();
                const feedback = buildFeedbackBlock(feedbackList);
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                  body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 8192,
                    system: [{ type: 'text', text: SONNET_SYSTEM + feedback, cache_control: { type: 'ephemeral' } }],
                    messages: [{ role: 'user', content: userContent }] }),
                });
                const data = await response.json();
                const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
                logAnalysis({ fileName, analysisText: text, fileSizeMb, userEmail }).catch(() => {});
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ text }));
              } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err.message })); }
            });
          });

          // --- /api/analyze-docs (on-demand) ---
          server.middlewares.use('/api/analyze-docs', async (req, res) => {
            if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
              try {
                const { pdfText } = JSON.parse(body);
                if (!pdfText || !pdfText.trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'pdfText required' })); return; }
                const trimmed = pdfText.slice(0, 80000);
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                  body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2048,
                    system: DOCS_SYSTEM,
                    messages: [{ role: 'user', content: `<pitch_book_text>\n${trimmed}\n</pitch_book_text>\n\n${DOCS_USER_MSG}` }] }),
                });
                const data = await response.json();
                const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ text }));
              } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err.message })); }
            });
          });
        },
      },
    ],
  }
})
