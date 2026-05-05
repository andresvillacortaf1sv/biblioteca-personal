exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = JSON.parse(event.body);
    const apiKey = process.env.GROQ_API_KEY;

    // Extract prompt from Anthropic-style messages
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

    if (!groqRes.ok) {
      return {
        statusCode: groqRes.status,
        headers,
        body: JSON.stringify({ error: groqData }),
      };
    }

    // Convert Groq response to Anthropic-style format
    const text = groqData.choices?.[0]?.message?.content || '';
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        content: [{ type: 'text', text }],
        usage: groqData.usage,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
