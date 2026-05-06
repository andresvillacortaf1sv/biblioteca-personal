export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = req.body;
    const apiKey = process.env.GROQ_API_KEY;

    const userMessage = body.messages.find(m => m.role === 'user');
    const prompt = typeof userMessage.content === 'string'
      ? userMessage.content
      : userMessage.content.map(c => c.text || '').join('');

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: body.max_tokens || 1200,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const groqData = await groqRes.json();
    if (!groqRes.ok) return res.status(groqRes.status).json({ error: groqData });

    const text = groqData.choices?.[0]?.message?.content || '';
    return res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
