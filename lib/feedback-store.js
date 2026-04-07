import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// In production (Vercel), feedback.json is read-only from the repo.
// For persistence across deploys, migrate to Supabase.
// Locally, reads/writes to feedback.json in project root.

const FEEDBACK_PATH = resolve(process.cwd(), 'feedback.json');

export function readFeedback() {
  try {
    return JSON.parse(readFileSync(FEEDBACK_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

export function writeFeedback(list) {
  try {
    writeFileSync(FEEDBACK_PATH, JSON.stringify(list, null, 2) + '\n', 'utf-8');
  } catch (e) {
    // On Vercel, filesystem is read-only — this will fail silently
    console.warn('[feedback] Could not write feedback.json:', e.message);
  }
}
