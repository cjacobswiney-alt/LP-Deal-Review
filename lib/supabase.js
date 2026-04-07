import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.VITE_SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[supabase] Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '');
