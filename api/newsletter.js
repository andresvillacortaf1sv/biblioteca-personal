// Newsletter generator — called weekly via cron or manually
// Generates HTML email with top news, rec of the week, and cycle
// Uses Groq to write the editorial content

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const apiKey = process.env.GROQ_API_KEY;
  const now = new Date();
  const dateStr = now.toLocaleDateString('es', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const weekNum = Math.ceil((now - new Date(now.getFullYear(),0,1)) / (7*24*60*60*1000));

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const films = body.films || []; // Top films passed from client
    const topFilms = films.slice(0,20).map(f=>`${f.title} (${f.year||'?'}) — ${f.director||'?'} — nota: ${f.rating}`).join('\n');

    const prompt = `Eres el editor de "Espacio Cinéfilo", el boletín semanal de la Academia Otto Salamanca. 
Redacta un newsletter de cine semanal cálido, culto y apasionado.

Fecha: ${dateStr}
Número de semana: ${weekNum}

BIBLIOTECA DEL SUSCRIPTOR (top 20 películas):
${topFilms}

Responde SOLO con JSON válido sin backticks:
{
  "subject": "Asunto del email (atractivo, máx 60 caracteres)",
  "editorial": "Párrafo editorial de bienvenida, reflexivo sobre el cine de esta semana (3-4 frases)",
  "recSemana": {
    "title": "Película recomendada de la semana",
    "year": 1972,
    "director": "Director",
    "why": "Por qué ver esta película esta semana específicamente (2-3 frases apasionadas)"
  },
  "efemeride": "Una efeméride cinematográfica relevante de esta semana (1-2 frases)",
  "frase": "Frase célebre sobre el cine para cerrar el boletín",
  "fraseAutor": "Autor de la frase"
}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 800,
        temperature: 0.8,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const content = JSON.parse(cleaned);

    // Generate HTML email
    const html = generateNewsletterHTML(content, dateStr, weekNum);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ content, html, subject: content.subject }),
    };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function generateNewsletterHTML(c, dateStr, weekNum) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${c.subject}</title>
<style>
  body{margin:0;padding:0;background:#0b0b0e;font-family:Georgia,serif;color:#eeeae3;}
  .wrap{max-width:600px;margin:0 auto;background:#131317;}
  .header{background:#0b0b0e;padding:32px 40px;border-bottom:1px solid rgba(255,255,255,.08);}
  .logo{font-family:Georgia,serif;font-size:22px;color:#f0c050;letter-spacing:-.3px;}
  .logo em{font-style:italic;}
  .edition{font-size:10px;text-transform:uppercase;letter-spacing:.16em;color:#4e4a58;margin-top:6px;}
  .section{padding:28px 40px;border-bottom:1px solid rgba(255,255,255,.06);}
  .section-label{font-size:9px;text-transform:uppercase;letter-spacing:.18em;color:#c9952e;margin-bottom:14px;}
  .editorial{font-size:15px;line-height:1.85;color:#c8c4bc;}
  .rec-title{font-size:22px;line-height:1.2;margin-bottom:6px;color:#eeeae3;}
  .rec-meta{font-size:11px;color:#f0c050;margin-bottom:12px;}
  .rec-why{font-size:13px;line-height:1.8;color:#8e8a96;}
  .efem{font-size:13px;line-height:1.7;color:#8e8a96;font-style:italic;}
  .frase{font-size:16px;line-height:1.6;color:#eeeae3;font-style:italic;text-align:center;padding:0 20px;}
  .frase-autor{font-size:11px;color:#4e4a58;text-align:center;margin-top:8px;}
  .footer{padding:20px 40px;text-align:center;font-size:10px;color:#4e4a58;border-top:1px solid rgba(255,255,255,.06);}
  .divider{height:1px;background:rgba(255,255,255,.06);margin:0;}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">Espacio <em>Cinéfilo</em></div>
    <div class="edition">Academia Otto Salamanca · Semana ${weekNum} · ${dateStr}</div>
  </div>

  <div class="section">
    <div class="section-label">Editorial</div>
    <div class="editorial">${c.editorial}</div>
  </div>

  <div class="section">
    <div class="section-label">Recomendación de la semana</div>
    <div class="rec-title">${c.recSemana?.title} (${c.recSemana?.year})</div>
    <div class="rec-meta">Dir. ${c.recSemana?.director}</div>
    <div class="rec-why">${c.recSemana?.why}</div>
  </div>

  <div class="section">
    <div class="section-label">Efeméride</div>
    <div class="efem">${c.efemeride}</div>
  </div>

  <div class="section">
    <div class="frase">"${c.frase}"</div>
    <div class="frase-autor">— ${c.fraseAutor}</div>
  </div>

  <div class="footer">
    Espacio Cinéfilo · Academia Otto Salamanca<br>
    Este boletín fue generado para amantes del cine
  </div>
</div>
</body>
</html>`;
}
