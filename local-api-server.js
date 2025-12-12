require('dotenv').config({ path: '.env.local', override: true });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- DeepSeek Proxy ---
app.post('/api/deepseek-proxy', async (req, res) => {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      console.error('[ERROR] DEEPSEEK_API_KEY no configurada en .env.local');
      return res.status(500).json({
        error: 'DEEPSEEK_API_KEY not configured',
        message: 'Configure DEEPSEEK_API_KEY en .env.local'
      });
    }

    const { payload, action } = req.body;
    const apiBody = payload || req.body;

    console.log(`[API] DeepSeek API call received (action: ${action || 'direct'})`);

    const url = 'https://api.deepseek.com/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(apiBody)
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error('[ERROR] DeepSeek API Error Response:', JSON.stringify(responseData, null, 2));
      return res.status(response.status).json(responseData);
    }

    console.log(`[SUCCESS] DeepSeek response successful`);
    res.status(200).json(responseData);

  } catch (error) {
    console.error('[ERROR] DeepSeek API error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


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
    // Extract the actual API body from the proxy payload or use body directly
    const apiBody = payload || req.body;

    console.log(`[API] Gemini API call received (action: ${action || 'direct'}) - Model: gemini-2.5-flash`);

    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(apiBody)
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error('[ERROR] Gemini API Error Response:', JSON.stringify(responseData, null, 2));
      return res.status(response.status).json(responseData);
    }

    console.log(`[SUCCESS] Gemini response successful`);
    // The frontend expects the raw API response structure (candidates, etc.)
    res.status(200).json(responseData);

  } catch (error) {
    console.error('[ERROR] Gemini API error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n[SERVER] Local API server running on http://localhost:${PORT}`);
  console.log(`[ENDPOINT] http://localhost:${PORT}/api/gemini-proxy`);
  console.log(`[API_KEY] GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'Configured' : 'Missing'}`);
  console.log(`[MODEL] Using gemini-2.5-flash-lite (v1 REST API)\n`);
});
