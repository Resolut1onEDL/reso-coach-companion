// Upload the RAW ParsedReplay to app.reso.coach /api/replays.
// Auth: a per-user upload token (Bearer) obtained via the Steam device-link.
// The web expects the raw replay JSON body (no wrapper).

const RESO_DEFAULT_URL = 'https://app.reso.coach';

// Returns null when not linked (no token) so callers can skip it silently.
async function uploadToReso({ parsed, resoUrl, resoToken }) {
  if (!resoToken) return null;
  const baseUrl = (resoUrl || RESO_DEFAULT_URL).replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/api/replays`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resoToken}`,
    },
    body: JSON.stringify(parsed),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`reso non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`reso upload failed: ${json?.error || `HTTP ${res.status}`}`);
  return json;
}

// ── Retry queue ──────────────────────────────────────────────────────────────
// A failed upload is persisted as pending JSON and replayed on the next start
// (and right after a successful Steam link). Without this, a match played
// during a transient network error / server 5xx would be lost forever: the
// watcher marks the .dem processed and never re-emits it.

const fs = require('node:fs');
const path = require('node:path');

function saveForRetry(dir, parsed) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${parsed?.id ?? Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(parsed));
  return file;
}

async function retryPending({ dir, resoUrl, resoToken, log = () => {} } = {}) {
  if (!resoToken || !fs.existsSync(dir)) return { retried: 0, succeeded: 0, failed: 0 };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  let succeeded = 0;
  let failed = 0;
  for (const f of files) {
    const filePath = path.join(dir, f);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      await uploadToReso({ parsed, resoUrl, resoToken });
      fs.unlinkSync(filePath);
      succeeded++;
      log(`retry ok: ${f}`);
    } catch (e) {
      failed++;
      log(`retry failed: ${f} — ${e.message}`);
    }
  }
  return { retried: files.length, succeeded, failed };
}

module.exports = { uploadToReso, saveForRetry, retryPending, RESO_DEFAULT_URL };
