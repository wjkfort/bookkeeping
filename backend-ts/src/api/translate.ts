import { Hono } from 'hono';
import type { Env, TranslateRequest } from '../types';

const app = new Hono<{ Bindings: Env }>();

// POST /api/v1/translate - Translate text between languages
app.post('/', async (c) => {
  try {
    const body = await c.req.json<TranslateRequest>();
    const { text, from_lang, to_lang } = body;

    if (!text || !from_lang || !to_lang) {
      return c.json({ error: 'text, from_lang, and to_lang are required' }, 400);
    }

    // Use Google Translate API (free, no auth required)
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from_lang}&tl=${to_lang}&dt=t&q=${encodeURIComponent(text)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    // Extract translated text from response
    const translatedText = data[0][0][0];

    return c.json({ text: translatedText });
  } catch (error) {
    console.error('Translation error:', error);
    return c.json({ error: 'Failed to translate text' }, 500);
  }
});

export default app;
