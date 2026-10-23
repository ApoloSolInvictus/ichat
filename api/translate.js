export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const { text, fromLang, toLang } = req.body;

  if (!text || !fromLang || !toLang) {
    return res.status(400).json({ error: 'Faltan parámetros: text, fromLang o toLang.' });
  }

  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
    
    // Voice ID de ElevenLabs (Por defecto usa Rachel '21m00Tcm4TlvDq8ikWAM' o la que configures en Vercel)
    const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; 
    const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (!openaiApiKey) {
      console.error("Falta OPENAI_API_KEY en las variables de entorno de Vercel.");
      return res.status(500).json({ 
        error: 'Falta OPENAI_API_KEY en las Variables de Entorno de Vercel.' 
      });
    }

    if (!elevenLabsApiKey) {
      console.error("Falta ELEVENLABS_API_KEY en las variables de entorno de Vercel.");
      return res.status(500).json({ 
        error: 'Falta ELEVENLABS_API_KEY en las Variables de Entorno de Vercel.' 
      });
    }

    // 1. Traducción del texto usando prompt contextual multilingüe
    const systemPrompt = `You are an expert native interpreter. Translate the text from language code '${fromLang}' to '${toLang}'. Capture the local dialect, idiom, and slang if applicable based on the language codes. Only return the translated text, absolutely nothing else. Do not add quotes.`;

    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.3
      })
    });

    const data = await openAiResponse.json();

    if (data.error) {
      console.error("Error devuelto por el traductor:", data.error);
      return res.status(400).json({ 
        error: `Error de traducción (${data.error.type || 'api_error'}): ${data.error.message}` 
      });
    }

    const translatedText = data.choices[0].message.content.trim();

    // 2. Generación de audio ultra-realista con ElevenLabs (multilingual_v2)
    let audioContent = null;
    try {
      const elevenLabsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsApiKey
        },
        body: JSON.stringify({
          text: translatedText,
          model_id: 'eleven_multilingual_v2', // Excelente soporte para más de 29 idiomas y dialectos
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true
          }
        })
      });

      if (elevenLabsResponse.ok) {
        const audioBuffer = await elevenLabsResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');
        audioContent = `data:audio/mp3;base64,${base64Audio}`;
      } else {
        const errorDetails = await elevenLabsResponse.text();
        console.warn('ElevenLabs API respondió con error:', errorDetails);
      }
    } catch (ttsError) {
      console.warn('Fallback a síntesis local activado debido a error en ElevenLabs:', ttsError);
    }

    res.status(200).json({ translatedText, audioContent });

  } catch (error) {
    console.error('Error interno del servidor:', error);
    res.status(500).json({ error: 'Error al procesar la traducción y voz en el servidor.' });
  }
}
