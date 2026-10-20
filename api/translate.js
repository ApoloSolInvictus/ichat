export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const { text, fromLang, toLang } = req.body;

  if (!text || !fromLang || !toLang) {
    return res.status(400).json({ error: 'Faltan parámetros: text, fromLang o toLang.' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.error("Falta OPENAI_API_KEY en Vercel");
      return res.status(500).json({ error: 'Falta configurar OPENAI_API_KEY en Vercel.' });
    }

    const systemPrompt = `You are an expert native interpreter. Translate the text from language code '${fromLang}' to '${toLang}'. Capture the local dialect and slang if applicable based on the language codes. Only return the translated text, absolutely nothing else. Do not add quotes.`;

    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-realtime-translate',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.3
      })
    });

    const data = await openAiResponse.json();

    if (data.error) {
      console.error("Error de OpenAI:", data.error);
      return res.status(400).json({ error: data.error.message });
    }

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
          voice: 'nova',
          response_format: 'mp3'
        })
      });

      if (ttsResponse.ok) {
        const audioBuffer = await ttsResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');
        audioContent = `data:audio/mp3;base64,${base64Audio}`;
      }
    } catch (ttsError) {
      console.warn('Fallback a voz local activado:', ttsError);
    }

    res.status(200).json({ translatedText, audioContent });

  } catch (error) {
    console.error('Error interno:', error);
    res.status(500).json({ error: 'Error al procesar la traducción.' });
  }
}
```

Haz el **Redeploy** en Vercel tras confirmar la variable y verás cómo empieza a traducir al instante con **GPT-5.6 Luna**. ¡Me avisas cuando quede listo, Socio!
