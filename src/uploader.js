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

module.exports = { uploadToReso, RESO_DEFAULT_URL };
