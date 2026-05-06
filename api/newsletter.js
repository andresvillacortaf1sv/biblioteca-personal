export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.GROQ_API_KEY;
  const now = new Date();
  const dateStr = now.toLocaleDateString('es', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const weekNum = Math.ceil((now - new Date(now.getFullYear(),0,1)) / (7*24*60*60*1000));

  try {
    const body = req.body || {};
    const films = body.films || [];
    const topFilms = films.slice(0,20).map(f=>`${f.title} (${f.year||'?'}) — ${f.director||'?'} — nota: ${f.rating}`).join('\n');

    const prompt = `Eres el editor de "Espacio Cinéfilo", boletín semanal de la Academia Otto Salamanca.
Fecha: ${dateStr} · Semana ${weekNum}

TOP PELÍCULAS DEL SUSCRIPTOR:
${topFilms}

Responde SOLO con JSON válido sin backticks:
{
  "subject": "Asunto del email (máx 60 caracteres)",
  "editorial": "Párrafo reflexivo de bienvenida sobre el cine (3-4 frases)",
  "recSemana": { "title": "...", "year": 1972, "director": "...", "why": "Por qué ver esta película esta semana (2-3 frases)" },
  "efemeride": "Efeméride cinematográfica de esta semana (1-2 frases)",
  "frase": "Frase célebre sobre el cine",
  "fraseAutor": "Autor"
}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 800, temperature: 0.8, messages: [{ role: 'user', content: prompt }] }),
    });

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const content = JSON.parse(cleaned);
    const html = generateHTML(content, dateStr, weekNum);
    return res.status(200).json({ content, html, subject: content.subject });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function generateHTML(c, dateStr, weekNum) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${c.subject}</title>
<style>body{margin:0;padding:0;background:#0b0b0e;font-family:Georgia,serif;color:#eeeae3;}
.wrap{max-width:600px;margin:0 auto;background:#131317;}
.header{background:#0b0b0e;padding:32px 40px;border-bottom:1px solid rgba(255,255,255,.08);}
.logo{font-size:22px;color:#f0c050;}.logo em{font-style:italic;}
.edition{font-size:10px;text-transform:uppercase;letter-spacing:.16em;color:#4e4a58;margin-top:6px;}
.section{padding:24px 40px;border-bottom:1px solid rgba(255,255,255,.06);}
.label{font-size:9px;text-transform:uppercase;letter-spacing:.18em;color:#c9952e;margin-bottom:12px;}
.editorial{font-size:14px;line-height:1.85;color:#c8c4bc;}
.rec-title{font-size:20px;margin-bottom:4px;}
.rec-meta{font-size:11px;color:#f0c050;margin-bottom:10px;}
.rec-why{font-size:13px;line-height:1.8;color:#8e8a96;}
.efem{font-size:13px;line-height:1.7;color:#8e8a96;font-style:italic;}
.frase{font-size:15px;line-height:1.6;font-style:italic;text-align:center;padding:0 20px;}
.autor{font-size:11px;color:#4e4a58;text-align:center;margin-top:6px;}
.footer{padding:18px 40px;text-align:center;font-size:10px;color:#4e4a58;}</style>
</head><body><div class="wrap">
<div class="header"><div class="logo">Espacio <em>Cinéfilo</em></div><div class="edition">Academia Otto Salamanca · Semana ${weekNum} · ${dateStr}</div></div>
<div class="section"><div class="label">Editorial</div><div class="editorial">${c.editorial}</div></div>
<div class="section"><div class="label">Recomendación de la semana</div><div class="rec-title">${c.recSemana?.title} (${c.recSemana?.year})</div><div class="rec-meta">Dir. ${c.recSemana?.director}</div><div class="rec-why">${c.recSemana?.why}</div></div>
<div class="section"><div class="label">Efeméride</div><div class="efem">${c.efemeride}</div></div>
<div class="section"><div class="frase">"${c.frase}"</div><div class="autor">— ${c.fraseAutor}</div></div>
<div class="footer">Espacio Cinéfilo · Academia Otto Salamanca</div>
</div></body></html>`;
}
