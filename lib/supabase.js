import { createClient } from '@supabase/supabase-js';

let _supabase = null;

export function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.VITE_SUPABASE_SECRET_KEY;
    if (!url || !key) {
      console.warn('[supabase] Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
      return null;
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}
