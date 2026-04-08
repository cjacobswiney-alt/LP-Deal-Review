import { getSupabase } from '../lib/supabase.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  try {
    const { fileName, userEmail } = req.body;
    if (!fileName) { return res.status(400).json({ error: 'fileName required' }); }

    const supabase = getSupabase();
    if (!supabase) { return res.status(500).json({ error: 'Database not configured' }); }

    // Create a unique path
    const prefix = userEmail ? userEmail.replace(/[^a-z0-9]/gi, '_') : 'anonymous';
    const timestamp = Date.now();
    const path = `${prefix}/${timestamp}-${fileName}`;

    // Create a signed upload URL so the client can upload directly
    const { data, error } = await supabase.storage
      .from('pitch-books')
      .createSignedUploadUrl(path);

    if (error) { return res.status(500).json({ error: error.message }); }

    res.status(200).json({ signedUrl: data.signedUrl, path: data.path, token: data.token });
  } catch (err) {
    console.error('[upload] Error:', err);
    res.status(500).json({ error: err.message });
  }
}
