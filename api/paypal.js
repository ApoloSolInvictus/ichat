export default async function handler(req, res) {
  // Obtenemos las credenciales desde Vercel
  const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
  const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
  
  // Por defecto usa 'sandbox' para pruebas, pero si pones 'live' en Vercel, cobrará de verdad.
  const PAYPAL_ENVIRONMENT = process.env.PAYPAL_ENVIRONMENT || 'sandbox'; 
  
  const baseURL = PAYPAL_ENVIRONMENT === 'live' 
    ? 'https://api-m.paypal.com' 
    : 'https://api-m.sandbox.paypal.com';

  // Si el frontend solicita el Client ID para cargar el botón
  if (req.method === 'GET') {
    return res.status(200).json({ clientId: PAYPAL_CLIENT_ID });
  }

  if (req.method === 'POST') {
    const { action, orderID } = req.body;

    try {
      // 1. Autenticación con los servidores de PayPal
      const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
      const tokenRes = await fetch(`${baseURL}/v1/oauth2/token`, {
        method: 'POST',
        body: 'grant_type=client_credentials',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      // 2. Creación de una nueva orden de cobro ($14 USD)
      if (action === 'create') {
        const orderRes = await fetch(`${baseURL}/v2/checkout/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [{
              amount: { currency_code: 'USD', value: '14.00' },
              description: 'iChat Pro - Traductor de Voz De Por Vida'
            }]
          })
        });
        const orderData = await orderRes.json();
        return res.status(200).json({ id: orderData.id });
      }

      // 3. Captura (confirmación) del dinero una vez el usuario aprueba el pop-up
      if (action === 'capture') {
        const captureRes = await fetch(`${baseURL}/v2/checkout/orders/${orderID}/capture`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          }
        });
        const captureData = await captureRes.json();
        return res.status(200).json(captureData);
      }
    } catch (error) {
      console.error("Error en servidor PayPal:", error);
      return res.status(500).json({ error: 'Error procesando el pago con PayPal' });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}