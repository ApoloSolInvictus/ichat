import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/translate.js';
import { createAccessToken } from '../lib/access-token.js';

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('paid translation accepts a signed token and falls back to browser voice when TTS is unavailable', async () => {
  process.env.ACCESS_TOKEN_SECRET = 'test-secret-for-ichat';
  delete process.env.ELEVENLABS_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';

  const token = createAccessToken({ uid: 'user-123', orderID: 'order-456' });
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hola' }] }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const res = responseMock();
    await handler({
      method: 'POST',
      headers: { 'x-ichat-access-token': token },
      body: { text: 'Hello', fromLang: 'en-US', toLang: 'es-MX', uid: 'user-123' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.translatedText, 'Hola');
    assert.equal(res.payload.audioContent, null);
    assert.equal(res.payload.audioProvider, 'browser');
  } finally {
    global.fetch = originalFetch;
  }
});

test('paid translation rejects missing access tokens before calling providers', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('provider should not be called'); };

  try {
    const res = responseMock();
    await handler({
      method: 'POST',
      headers: {},
      body: { text: 'Hello', fromLang: 'en-US', toLang: 'es-MX', uid: 'user-123' }
    }, res);

    assert.equal(res.statusCode, 401);
  } finally {
    global.fetch = originalFetch;
  }
});
