import {
  createAccessToken,
  getRequestHeader,
  isTestModeEnabled,
  verifyAccessToken
} from '../lib/access-token.js';
import { isFreeAccessEmail, verifyFirebaseIdentity } from '../lib/firebase-access.js';

function json(res, status, payload) {
  res.setHeader?.('Cache-Control', 'no-store');
  res.setHeader?.('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(payload);
}

function getBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function getConfig() {
  const environment = process.env.PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox';
  return {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    secret: process.env.PAYPAL_SECRET || '',
    baseURL: environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    environment
  };
}

async function paypalJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function getPayPalAccessToken(config) {
  if (!config.clientId || !config.secret) throw new Error('PayPal no está configurado.');

  const auth = Buffer.from(`${config.clientId}:${config.secret}`).toString('base64');
  const { response, data } = await paypalJson(`${config.baseURL}/v1/oauth2/token`, {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  if (!response.ok || !data.access_token) throw new Error('PayPal no autorizó la solicitud.');
  return data.access_token;
}

export default async function handler(req, res) {
  const config = getConfig();

  if (req.method === 'GET') {
    return json(res, 200, {
      clientId: config.clientId,
      environment: config.environment,
      testMode: isTestModeEnabled()
    });
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido.' });

  const body = getBody(req);
  const action = body.action;
  const uid = typeof body.uid === 'string' ? body.uid.trim() : '';

  try {
    if (action === 'verify') {
      const token = body.accessToken || getRequestHeader(req, 'x-ichat-access-token');
      const payload = verifyAccessToken(token, uid);
      return json(res, 200, { valid: Boolean(payload), expiresAt: payload?.exp || null });
    }

    if (action === 'test-access') {
      if (!isTestModeEnabled() || !uid) return json(res, 403, { error: 'El modo de prueba está desactivado.' });
      const accessToken = createAccessToken({ uid, orderID: 'test-mode' });
      if (!accessToken) return json(res, 500, { error: 'Falta ACCESS_TOKEN_SECRET en el servidor.' });
      return json(res, 200, { accessToken, testMode: true });
    }

    if (action === 'free-access') {
      const identity = await verifyFirebaseIdentity(req, body);
      if (!identity || !identity.emailVerified || !isFreeAccessEmail(identity.email)) {
        return json(res, 403, { error: 'Esta cuenta no tiene acceso gratuito.' });
      }
      if (uid && uid !== identity.uid) {
        return json(res, 403, { error: 'La identidad del usuario no coincide.' });
      }

      const accessToken = createAccessToken({
        uid: identity.uid,
        orderID: 'free-access',
        scope: 'free'
      });
      if (!accessToken) return json(res, 500, { error: 'Falta ACCESS_TOKEN_SECRET en el servidor.' });

      return json(res, 200, {
        accessToken,
        freeAccess: true,
        email: identity.email
      });
    }

    const paypalToken = await getPayPalAccessToken(config);

    if (action === 'create') {
      if (!uid) return json(res, 400, { error: 'Falta el identificador del usuario.' });

      const { response, data } = await paypalJson(`${config.baseURL}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${paypalToken}`,
          'PayPal-Request-Id': `ichat-${uid}-${Date.now()}`
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            amount: { currency_code: 'USD', value: '14.00' },
            description: 'iChat Pro - Traductor de Voz De Por Vida'
          }]
        })
      });

      if (!response.ok || !data.id) return json(res, 502, { error: 'PayPal no pudo crear la orden.' });
      return json(res, 200, { id: data.id });
    }

    if (action === 'capture') {
      const orderID = typeof body.orderID === 'string' ? body.orderID.trim() : '';
      if (!orderID || !uid) return json(res, 400, { error: 'Faltan orderID o el identificador del usuario.' });

      const { response, data } = await paypalJson(`${config.baseURL}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${paypalToken}`,
          'PayPal-Request-Id': `ichat-capture-${orderID}`
        }
      });

      if (!response.ok || data.status !== 'COMPLETED') {
        return json(res, 502, { error: 'PayPal no pudo confirmar el pago.', status: data.status || 'UNKNOWN' });
      }

      const accessToken = createAccessToken({ uid, orderID });
      if (!accessToken) return json(res, 500, { error: 'Falta ACCESS_TOKEN_SECRET en el servidor.' });
      return json(res, 200, { status: data.status, accessToken });
    }

    return json(res, 400, { error: 'Acción no válida.' });
  } catch (error) {
    console.error('PayPal server error:', error?.message || 'unknown');
    return json(res, 500, { error: 'Error procesando la operación de PayPal.' });
  }
}
