require('dotenv').config({ path: '.env.local', override: true });
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.post('/api/gemini-proxy', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error('[ERROR] GEMINI_API_KEY no configurada en .env.local');
      return res.status(500).json({
        error: 'GEMINI_API_KEY not configured',
        message: 'Configure GEMINI_API_KEY en .env.local'
      });
    }

    const { payload, action } = req.body;
    const { contents, generationConfig } = payload || req.body;

    console.log(`[API] Gemini API call received (action: ${action || 'direct'})`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent({
      contents,
      generationConfig
    });

    const responseData = result.response;

    console.log(`[SUCCESS] Gemini response successful`);
    res.status(200).json(responseData);

  } catch (error) {
    console.error('[ERROR] Gemini API error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n[SERVER] Local API server running on http://localhost:${PORT}`);
  console.log(`[ENDPOINT] http://localhost:${PORT}/api/gemini-proxy`);
  console.log(`[API_KEY] GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'Configured' : 'Missing'}\n`);
});
