export default async function handler(req, res) {
  // Solo aceptamos solicitudes POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const { text, fromLang, toLang } = req.body;

  // Validar que vengan todos los datos necesarios
  if (!text || !fromLang || !toLang) {
    return res.status(400).json({ error: 'Faltan parámetros: text, fromLang o toLang.' });
  }

  try {
    // Aquí Vercel leerá tu variable de entorno
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.error("Falta OPENAI_API_KEY en Vercel");
      return res.status(500).json({ error: 'Servidor no configurado correctamente.' });
    }

    // Instrucción para que actúe como un traductor nativo y entienda el léxico del país
    const systemPrompt = `You are an expert native interpreter. Translate the text from language code '${fromLang}' to '${toLang}'. Capture the local dialect and slang if applicable based on the language codes. Only return the translated text, absolutely nothing else. Do not add quotes.`;

    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Usamos este modelo porque es rapidísimo y muy económico para textos
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.3 // Temperatura baja para que sea preciso y no invente cosas
      })
    });

    const data = await openAiResponse.json();

    if (data.error) {
      console.error("Error de OpenAI:", data.error);
      throw new Error(data.error.message);
    }

    // Extraemos solo el texto limpio
    const translatedText = data.choices[0].message.content.trim();

    let audioContent = null;
    try {
      const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: translatedText,
          voice: 'nova', // Opciones de voces hiperrealistas: 'nova', 'alloy', 'shimmer', 'echo', 'fable', 'onyx'
          response_format: 'mp3'
        })
      });

      if (ttsResponse.ok) {
        const audioBuffer = await ttsResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');
        audioContent = `data:audio/mp3;base64,${base64Audio}`;
      }
    } catch (ttsError) {
      console.warn('Error generando voz OpenAI TTS, fallback activado:', ttsError);
    }

    // Respondemos con la traducción y el audio HD
    res.status(200).json({ translatedText, audioContent });

  } catch (error) {
    console.error('Error interno:', error);
    res.status(500).json({ error: 'Error al procesar la traducción.' });
  }
}
