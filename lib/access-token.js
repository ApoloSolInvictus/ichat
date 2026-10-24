import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 365;

function getSecret() {
  // ACCESS_TOKEN_SECRET is preferred. PAYPAL_SECRET keeps existing deployments
  // working during the migration, but should be replaced with a dedicated secret.
  return process.env.ACCESS_TOKEN_SECRET || process.env.PAYPAL_SECRET || '';
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function sign(input, secret) {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function createAccessToken({ uid, orderID, scope = 'pro', ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const secret = getSecret();
  if (!secret || !uid) return null;

  const now = Math.floor(Date.now() / 1000);
  const parsedTtl = Number(ttlSeconds);
  const effectiveTtl = Number.isFinite(parsedTtl) ? parsedTtl : DEFAULT_TTL_SECONDS;
  const payload = {
    sub: String(uid),
    scope,
    orderID: orderID ? String(orderID) : undefined,
    iat: now,
    exp: now + effectiveTtl
  };

  const encodedPayload = encode(payload);
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyAccessToken(token, expectedUid) {
  const secret = getSecret();
  if (!secret || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  try {
    const expectedSignature = sign(parts[0], secret);
    const receivedSignature = Buffer.from(parts[1]);
    const validSignature = receivedSignature.length === Buffer.byteLength(expectedSignature)
      && timingSafeEqual(receivedSignature, Buffer.from(expectedSignature));

    if (!validSignature) return null;

    const payload = decode(parts[0]);
    const now = Math.floor(Date.now() / 1000);
    if (!payload || payload.scope !== 'pro' || !payload.sub || Number(payload.exp) <= now) {
      return null;
    }

    if (expectedUid && String(payload.sub) !== String(expectedUid)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isTestModeEnabled() {
  return process.env.ALLOW_TEST_MODE === 'true';
}

export function getRequestHeader(req, name) {
  const headers = req?.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  return headers[name] || headers[name.toLowerCase()] || '';
}
