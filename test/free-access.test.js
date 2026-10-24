import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/paypal.js';
import { verifyAccessToken } from '../lib/access-token.js';

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('free access is issued only to the verified allowlisted Firebase identity', async () => {
  process.env.ACCESS_TOKEN_SECRET = 'test-secret-for-ichat';
  process.env.FIREBASE_WEB_API_KEY = 'test-firebase-key';
  process.env.FREE_ACCESS_EMAILS = 'ronnywoods77@gmail.com';

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=test-firebase-key');
    assert.equal(JSON.parse(options.body).idToken, 'firebase-id-token');
    return new Response(JSON.stringify({
      users: [{
        localId: 'firebase-ronny',
        email: 'RonnyWoods77@gmail.com',
        emailVerified: true
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const res = responseMock();
    await handler({
      method: 'POST',
      headers: {},
      body: {
        action: 'free-access',
        uid: 'firebase-ronny',
        idToken: 'firebase-id-token'
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.freeAccess, true);
    assert.equal(res.payload.email, 'ronnywoods77@gmail.com');
    assert.equal(verifyAccessToken(res.payload.accessToken, 'firebase-ronny')?.scope, 'free');
  } finally {
    global.fetch = originalFetch;
  }
});

test('free access rejects a Firebase identity outside the exact allowlist', async () => {
  process.env.ACCESS_TOKEN_SECRET = 'test-secret-for-ichat';
  process.env.FIREBASE_WEB_API_KEY = 'test-firebase-key';
  process.env.FREE_ACCESS_EMAILS = 'ronnywoods77@gmail.com';

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    users: [{ localId: 'other-user', email: 'other@example.com', emailVerified: true }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  try {
    const res = responseMock();
    await handler({
      method: 'POST',
      headers: {},
      body: { action: 'free-access', uid: 'other-user', idToken: 'firebase-id-token' }
    }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.accessToken, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});
