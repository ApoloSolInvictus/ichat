import { getRequestHeader } from './access-token.js';

// Firebase Web API keys identify a project; they are not provider secrets. Keeping
// this fallback allows the existing iChat Firebase configuration to work while
// still supporting an explicit deployment variable for other environments.
const DEFAULT_FIREBASE_WEB_API_KEY = 'AIzaSyA3tRv3GJcvoKvLRkDqh4n0HM_Wq666tGY';
const DEFAULT_FREE_ACCESS_EMAILS = 'ronnywoods77@gmail.com';
const LOOKUP_TIMEOUT_MS = 5000;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function getFreeAccessEmails() {
  const configured = process.env.FREE_ACCESS_EMAILS ?? DEFAULT_FREE_ACCESS_EMAILS;
  return configured
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
}

export function isFreeAccessEmail(email) {
  return getFreeAccessEmails().includes(normalizeEmail(email));
}

function getFirebaseIdToken(req, body) {
  const authorization = getRequestHeader(req, 'authorization');
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return (bearerMatch?.[1] || (typeof body?.idToken === 'string' ? body.idToken.trim() : ''));
}

/**
 * Resolve the Firebase user behind an ID token using Firebase's public Auth
 * REST endpoint. The token is never logged or returned to the browser.
 */
export async function verifyFirebaseIdentity(req, body = {}) {
  const idToken = getFirebaseIdToken(req, body);
  const apiKey = process.env.FIREBASE_WEB_API_KEY || DEFAULT_FIREBASE_WEB_API_KEY;
  if (!idToken || !apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: controller.signal
      }
    );
    const data = await response.json().catch(() => ({}));
    const user = data?.users?.[0];

    if (!response.ok || !user?.localId || !user?.email) return null;

    return {
      uid: String(user.localId),
      email: normalizeEmail(user.email),
      emailVerified: user.emailVerified === true
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
