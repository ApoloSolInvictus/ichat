import { getRequestHeader, verifyAccessToken } from '../lib/access-token.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_TEXT_LENGTH = 2000;
const MAX_DEMO_TEXT_LENGTH = 240;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2,4})?$/;
const VOICE_PATTERN = /^[a-zA-Z0-9_-]{3,100}$/;

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

function getClientIp(req) {
  const forwarded = getRequestHeader(req, 'x-forwarded-for');
  return (forwarded.split(',')[0] || getRequestHeader(req, 'x-real-ip') || 'unknown').trim();
}

// This is intentionally small and best-effort because Vercel serverless instances
// are ephemeral. It still protects the demo from accidental refresh loops on warm instances.
const demoRequests = globalThis.__ichatDemoRequests || new Map();
globalThis.__ichatDemoRequests = demoRequests;

function allowDemoRequest(req) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const maxRequests = 8;
  const key = getClientIp(req);
  const recent = (demoRequests.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= maxRequests) return false;
  recent.push(now);
  demoRequests.set(key, recent);
  return true;
}

function apiKeys() {
  return [
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_API_KEY_2 || process.env.OPENAI_API_KEY_SECONDARY
  ].filter(Boolean);
}

function isRetryable(status) {
  return status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text.trim();

  const text = (data?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join(' ')
    .trim();

  return text;
}

async function translateWithOpenAI({ text, fromLang, toLang }) {
  const keys = apiKeys();
  if (!keys.length) {
    return { ok: false, status: 500, error: 'OpenAI no está configurado en el servidor.' };
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const instructions = [
    'You are an expert native interpreter.',
    `Translate from ${fromLang} to ${toLang}.`,
    'Preserve meaning, tone, regional idioms, and slang when appropriate.',
    'Return only the translated text. Do not add explanations or quotation marks.'
  ].join(' ');

  let lastStatus = 502;
  for (let index = 0; index < keys.length; index += 1) {
    try {
      const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${keys[index]}`
        },
        body: JSON.stringify({
          model,
          instructions,
          input: text
        })
      }, 15000);

      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const translatedText = extractResponseText(data);
        if (translatedText) return { ok: true, translatedText, model };
        lastStatus = 502;
      } else {
        lastStatus = response.status;
        console.warn(`OpenAI translation attempt ${index + 1} failed with status ${response.status}.`);
      }

      if (!isRetryable(response.status) || index === keys.length - 1) break;
    } catch (error) {
      lastStatus = error?.name === 'AbortError' ? 504 : 502;
      console.warn(`OpenAI translation attempt ${index + 1} failed: ${lastStatus}.`);
      if (index === keys.length - 1) break;
    }
  }

  return { ok: false, status: lastStatus, error: 'No se pudo completar la traducción con OpenAI.' };
}

async function createElevenLabsAudio(translatedText) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { audioContent: null, audioError: 'ElevenLabs no está configurado.' };

  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  if (!VOICE_PATTERN.test(voiceId)) {
    return { audioContent: null, audioError: 'La voz de ElevenLabs no es válida.' };
  }

  try {
    const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';
    const response = await fetchWithTimeout(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${encodeURIComponent(outputFormat)}`, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: translatedText,
        model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
        }
      })
    }, 20000);

    if (!response.ok) {
      console.warn(`ElevenLabs returned status ${response.status}.`);
      return { audioContent: null, audioError: 'ElevenLabs no pudo generar el audio.' };
    }

    const audioBuffer = await response.arrayBuffer();
    if (!audioBuffer.byteLength) return { audioContent: null, audioError: 'ElevenLabs devolvió audio vacío.' };

    return {
      audioContent: `data:audio/mpeg;base64,${Buffer.from(audioBuffer).toString('base64')}`,
      audioMimeType: 'audio/mpeg',
      audioProvider: 'elevenlabs'
    };
  } catch (error) {
    console.warn(`ElevenLabs request failed: ${error?.name || 'unknown'}.`);
    return { audioContent: null, audioError: 'ElevenLabs no está disponible temporalmente.' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido. Usa POST.' });

  const body = getBody(req);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const fromLang = typeof body.fromLang === 'string' ? body.fromLang.trim() : '';
  const toLang = typeof body.toLang === 'string' ? body.toLang.trim() : '';
  const isDemo = body.demo === true;

  if (!text || !fromLang || !toLang) {
    return json(res, 400, { error: 'Faltan parámetros: text, fromLang o toLang.' });
  }
  if (!LANGUAGE_PATTERN.test(fromLang) || !LANGUAGE_PATTERN.test(toLang)) {
    return json(res, 400, { error: 'Código de idioma no válido.' });
  }

  if (text.length > (isDemo ? MAX_DEMO_TEXT_LENGTH : MAX_TEXT_LENGTH)) {
    return json(res, 413, { error: `El texto supera el límite permitido de ${isDemo ? MAX_DEMO_TEXT_LENGTH : MAX_TEXT_LENGTH} caracteres.` });
  }

  if (isDemo) {
    if (!allowDemoRequest(req)) return json(res, 429, { error: 'Límite de demostraciones alcanzado. Intenta más tarde.' });
  } else {
    const accessToken = getRequestHeader(req, 'x-ichat-access-token') || body.accessToken;
    const tokenPayload = verifyAccessToken(accessToken, body.uid);
    if (!tokenPayload) {
      return json(res, 401, { error: 'Acceso Pro no válido o expirado.' });
    }
  }

  try {
    const translation = await translateWithOpenAI({ text, fromLang, toLang });
    if (!translation.ok) return json(res, translation.status, { error: translation.error });

    const audio = await createElevenLabsAudio(translation.translatedText);
    return json(res, 200, {
      translatedText: translation.translatedText,
      audioContent: audio.audioContent,
      audioMimeType: audio.audioMimeType || null,
      audioProvider: audio.audioProvider || 'browser',
      audioError: audio.audioError || null,
      model: translation.model
    });
  } catch (error) {
    console.error('Unexpected translation error:', error?.message || 'unknown');
    return json(res, 500, { error: 'Error interno al procesar la traducción.' });
  }
}
