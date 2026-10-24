import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessToken, verifyAccessToken } from '../lib/access-token.js';

test('access tokens are signed and bound to the user', () => {
  process.env.ACCESS_TOKEN_SECRET = 'test-secret-for-ichat';
  const token = createAccessToken({ uid: 'user-123', orderID: 'order-456', ttlSeconds: 3600 });

  assert.equal(typeof token, 'string');
  assert.equal(verifyAccessToken(token, 'user-123')?.orderID, 'order-456');
  assert.equal(verifyAccessToken(token, 'other-user'), null);
});

test('tampered and expired tokens are rejected', () => {
  process.env.ACCESS_TOKEN_SECRET = 'test-secret-for-ichat';
  const token = createAccessToken({ uid: 'user-123', ttlSeconds: -1 });
  const tampered = `${token}x`;

  assert.equal(verifyAccessToken(tampered, 'user-123'), null);
  assert.equal(verifyAccessToken(token, 'user-123'), null);
});
