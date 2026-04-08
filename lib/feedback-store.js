import { getSupabase } from './supabase.js';

// Read only APPROVED feedback rules (used in system prompt)
export async function readApprovedFeedback() {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('feedback_rules')
    .select('text, created_at')
    .eq('status', 'approved')
    .order('created_at', { ascending: true });
  if (error) { console.error('[feedback] Read error:', error.message); return []; }
  return data.map(r => ({ text: r.text, date: r.created_at?.slice(0, 10) }));
}

// Read ALL feedback rules (for display in UI)
export async function readAllFeedback() {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('feedback_rules')
    .select('id, text, status, created_at')
    .order('created_at', { ascending: true });
  if (error) { console.error('[feedback] Read error:', error.message); return []; }
  return data.map(r => ({ id: r.id, text: r.text, status: r.status, date: r.created_at?.slice(0, 10) }));
}

// Add new feedback rules (status = 'pending' by default)
export async function addFeedbackRules(rules, submittedBy) {
  const supabase = getSupabase();
  if (!supabase) return [];
  const rows = rules.map(text => ({ text: String(text).trim(), submitted_by: submittedBy || null }));
  const { error } = await supabase.from('feedback_rules').insert(rows);
  if (error) console.error('[feedback] Insert error:', error.message);
  return readAllFeedback();
}

// Delete a feedback rule by id
export async function deleteFeedbackRule(id) {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { error } = await supabase.from('feedback_rules').delete().eq('id', id);
  if (error) console.error('[feedback] Delete error:', error.message);
  return readAllFeedback();
}

// Log an analysis
export async function logAnalysis({ fileName, analysisText, userEmail, fileSizeMb }) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('analyses').insert({
    file_name: fileName,
    analysis_text: analysisText,
    user_email: userEmail || null,
    file_size_mb: fileSizeMb || null,
  });
  if (error) console.error('[analysis] Log error:', error.message);
}
