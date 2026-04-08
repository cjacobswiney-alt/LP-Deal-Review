import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  try {
    const { email, name, company } = req.body;
    if (!email || !email.trim()) { return res.status(400).json({ error: 'email required' }); }

    const supabase = getSupabase();
    if (!supabase) { return res.status(500).json({ error: 'Database not configured' }); }

    const { error } = await supabase
      .from('app_users')
      .upsert({ email: email.trim().toLowerCase(), name: name?.trim() || null, company: company?.trim() || null }, { onConflict: 'email' });

    if (error) { return res.status(500).json({ error: error.message }); }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
