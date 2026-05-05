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
    const editorialOverride = body.editorial || null; // User's own editorial text
    const topFilms = films.slice(0,20).map(f=>`${f.title} (${f.year||'?'}) — ${f.director||'?'} — nota: ${f.rating}`).join('\n');

    // 1. Fetch RSS feeds for real news
    const feeds = [
      { url: 'https://variety.com/feed/', source: 'Variety', category: 'Hollywood' },
      { url: 'https://cineuropa.org/en/rss/', source: 'Cineuropa', category: 'Cine Europeo' },
      { url: 'https://www.screendaily.com/rss', source: 'Screen Daily', category: 'Festivales' },
      { url: 'https://www.indiewire.com/feed/', source: 'IndieWire', category: 'Cine Independiente' },
    ];

    const rssResults = await Promise.allSettled(feeds.map(f => fetchRSS(f)));
    let allItems = [];
    rssResults.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });

    // Filter last 7 days
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    allItems = allItems.filter(i => !i.pubDate || new Date(i.pubDate).getTime() > cutoff);
    allItems.sort((a,b) => new Date(b.pubDate||0) - new Date(a.pubDate||0));

    // 2. Fetch FilmFreeway RSS for festival opportunities
    let festOpps = [];
    try {
      const ffRes = await fetch('https://filmfreeway.com/festivals.rss', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000)
      });
      if (ffRes.ok) {
        const ffXml = await ffRes.text();
        festOpps = parseRSS(ffXml, { source: 'FilmFreeway' }).slice(0, 10);
      }
    } catch(e) {}

    // Fallback festival opps if RSS fails
    if (!festOpps.length) {
      festOpps = [
        { title: 'Open call — buscar en FilmFreeway', link: 'https://filmfreeway.com', source: 'FilmFreeway', description: 'Plataforma con cientos de festivales abiertos' },
        { title: 'Convocatorias abiertas — Festhome', link: 'https://festhome.com', source: 'Festhome', description: 'Directorio global de festivales de cine' },
      ];
    }

    const newsContext = allItems.slice(0,15).map((i,n) =>
      `[${n}] ${i.category||i.source}: ${i.title} — ${(i.description||'').slice(0,200)} | URL: ${i.link||''}`
    ).join('\n');

    const festContext = festOpps.slice(0,8).map((f,n) =>
      `[${n}] ${f.title} — ${(f.description||'').slice(0,150)} | URL: ${f.link||''}`
    ).join('\n');

    // 3. Generate content with Groq
    const prompt = `Eres el editor de "Espacio Cinéfilo", boletín semanal de la Academia Otto Salamanca de cine.
Fecha: ${dateStr} · Semana ${weekNum}

BIBLIOTECA DEL EDITOR (top 20 películas):
${topFilms}

NOTICIAS REALES DE RSS (últimos 7 días):
${newsContext || 'Sin noticias disponibles'}

CONVOCATORIAS DE FESTIVALES (FilmFreeway/Festhome):
${festContext || 'Sin convocatorias disponibles'}

Genera el contenido del newsletter. Responde SOLO con JSON válido sin backticks:
{
  "editorialIdea": "Idea/borrador corto para la editorial (2-3 frases que el editor puede expandir con su voz personal)",
  "recSemana": {
    "title": "Película recomendada NO vista por el editor",
    "year": 1972,
    "director": "Director",
    "why": "Por qué ver esta película esta semana — apasionado y específico (2-3 frases)"
  },
  "noticias": [
    {
      "categoria": "Hollywood",
      "titular": "Titular atractivo en español",
      "resumen": "2-3 frases del resumen en español basado en el contenido real",
      "fuente": "Nombre de la fuente",
      "url": "URL original exacta"
    },
    {
      "categoria": "Cine Latinoamericano",
      "titular": "...",
      "resumen": "...",
      "fuente": "...",
      "url": "..."
    },
    {
      "categoria": "Cine Europeo / Asiático",
      "titular": "...",
      "resumen": "...",
      "fuente": "...",
      "url": "..."
    }
  ],
  "festivales": [
    {
      "nombre": "Nombre del festival o convocatoria",
      "descripcion": "Qué buscan, géneros, duración máxima (1-2 frases)",
      "deadline": "Fecha límite si está disponible o 'Ver convocatoria'",
      "url": "URL directa a la convocatoria",
      "plataforma": "FilmFreeway o Festhome"
    }
  ],
  "efemeride": "Efeméride cinematográfica relevante de esta semana (1-2 frases)",
  "frase": "Frase célebre sobre el cine",
  "fraseAutor": "Autor"
}

REGLAS:
- Las 3 noticias DEBEN ser de categorías distintas: 1 Hollywood, 1 Latinoamérica, 1 Europa/Asia
- Si no hay noticias latinoamericanas en el RSS, genera una noticia relevante real de cine latinoamericano
- Los festivales: incluí 2-3 oportunidades reales de FilmFreeway/Festhome con deadlines si los hay
- La película recomendada NO debe estar en la lista de películas del editor`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1500,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }]
      }),
    });

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const content = JSON.parse(cleaned);

    // Use user's editorial if provided, else return the AI idea
    if (editorialOverride) content.editorial = editorialOverride;

    // Generate HTML only if editorial is finalized
    const html = editorialOverride ? generateHTML(content, dateStr, weekNum) : null;

    return res.status(200).json({ content, html, subject: `Espacio Cinéfilo · Semana ${weekNum} — ${content.recSemana?.title || 'Boletín semanal'}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function fetchRSS(feedConfig) {
  const res = await fetch(feedConfig.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader)' },
    signal: AbortSignal.timeout(5000),
  });
  const xml = await res.text();
  return parseRSS(xml, feedConfig);
}

function parseRSS(xml, feedConfig) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const get = (tag) => {
      const m = itemXml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const title = get('title');
    const link = (get('link') || itemXml.match(/<link>([^<]+)<\/link>/i)?.[1] || '').trim();
    const description = get('description').replace(/<[^>]+>/g, '').slice(0, 300);
    const pubDate = get('pubDate');
    if (title) items.push({ title, link, description, pubDate, source: feedConfig.source, category: feedConfig.category });
  }
  return items;
}

function generateHTML(c, dateStr, weekNum) {
  const noticiasHTML = (c.noticias || []).map(n => `
    <tr><td style="padding:20px 40px;border-bottom:1px solid #ece9e2;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.14em;color:#c9952e;margin-bottom:8px;font-family:Arial,sans-serif;">${n.categoria}</div>
      <div style="font-size:16px;color:#1a1814;margin-bottom:8px;line-height:1.3;">${n.titular}</div>
      <div style="font-size:13px;line-height:1.8;color:#4a4540;margin-bottom:10px;">${n.resumen}</div>
      <a href="${n.url}" style="font-size:11px;color:#c9952e;text-decoration:none;font-family:Arial,sans-serif;">Leer en ${n.fuente} →</a>
    </td></tr>`).join('');

  const festivalesHTML = (c.festivales || []).map(f => `
    <tr><td style="padding:14px 40px;border-bottom:1px solid #ece9e2;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:14px;color:#1a1814;font-weight:bold;margin-bottom:4px;">${f.nombre}</div>
            <div style="font-size:12px;color:#4a4540;line-height:1.7;margin-bottom:5px;">${f.descripcion}</div>
            <div style="font-size:11px;color:#8a7a5a;font-family:Arial,sans-serif;">📅 ${f.deadline} · ${f.plataforma}</div>
          </td>
          <td align="right" valign="middle" style="padding-left:16px;">
            <a href="${f.url}" style="background:#c9952e;color:#ffffff;text-decoration:none;padding:8px 16px;font-size:11px;font-family:Arial,sans-serif;white-space:nowrap;">Aplicar →</a>
          </td>
        </tr>
      </table>
    </td></tr>`).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${c.subject||'Espacio Cinéfilo'}</title></head>
<body style="margin:0;padding:0;background-color:#f4f1eb;font-family:Georgia,'Times New Roman',serif;color:#1a1814;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f1eb;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #ddd9d0;">

  <!-- HEADER -->
  <tr><td style="background:#1a1814;padding:28px 40px;border-bottom:3px solid #c9952e;">
    <div style="font-family:Georgia,serif;font-size:26px;color:#f0c050;">Espacio <em>Cinéfilo</em></div>
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.16em;color:#8a7a5a;margin-top:6px;font-family:Arial,sans-serif;">Academia Otto Salamanca · Semana ${weekNum} · ${dateStr}</div>
  </td></tr>

  <!-- EDITORIAL -->
  <tr><td style="padding:28px 40px;border-bottom:1px solid #ece9e2;">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.18em;color:#c9952e;margin-bottom:14px;font-family:Arial,sans-serif;">Editorial</div>
    <div style="font-size:15px;line-height:1.9;color:#2a2520;">${(c.editorial||'').replace(/\n/g,'<br>')}</div>
  </td></tr>

  <!-- NOTICIAS -->
  <tr><td style="padding:20px 40px 8px;background:#faf8f4;">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.18em;color:#c9952e;font-family:Arial,sans-serif;">Noticias de la semana</div>
  </td></tr>
  ${noticiasHTML}

  <!-- REC SEMANA -->
  <tr><td style="padding:28px 40px;border-bottom:1px solid #ece9e2;background:#faf8f4;">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.18em;color:#c9952e;margin-bottom:14px;font-family:Arial,sans-serif;">Recomendación de la semana</div>
    <div style="font-size:22px;line-height:1.2;color:#1a1814;margin-bottom:5px;">${c.recSemana?.title} <span style="font-size:14px;color:#8a7a5a;">(${c.recSemana?.year})</span></div>
    <div style="font-size:12px;color:#c9952e;margin-bottom:12px;font-family:Arial,sans-serif;">Dir. ${c.recSemana?.director}</div>
    <div style="font-size:14px;line-height:1.85;color:#4a4540;">${c.recSemana?.why}</div>
  </td></tr>

  <!-- FESTIVALES -->
  <tr><td style="padding:20px 40px 8px;">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.18em;color:#c9952e;font-family:Arial,sans-serif;">Oportunidades · Festivales &amp; Convocatorias</div>
  </td></tr>
  ${festivalesHTML}

  <!-- EFEMÉRIDE -->
  <tr><td style="padding:24px 40px;border-bottom:1px solid #ece9e2;background:#faf8f4;">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.18em;color:#c9952e;margin-bottom:12px;font-family:Arial,sans-serif;">Efeméride</div>
    <div style="font-size:14px;line-height:1.8;color:#4a4540;font-style:italic;">${c.efemeride}</div>
  </td></tr>

  <!-- FRASE -->
  <tr><td style="padding:28px 40px;border-bottom:1px solid #ece9e2;text-align:center;">
    <div style="font-size:17px;line-height:1.7;color:#1a1814;font-style:italic;padding:0 20px;">"${c.frase}"</div>
    <div style="font-size:12px;color:#8a7a5a;margin-top:10px;font-family:Arial,sans-serif;">— ${c.fraseAutor}</div>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:20px 40px;text-align:center;background:#1a1814;">
    <div style="font-size:10px;color:#5a5040;font-family:Arial,sans-serif;">Espacio Cinéfilo · Academia Otto Salamanca</div>
    <div style="font-size:10px;color:#3a3028;margin-top:4px;font-family:Arial,sans-serif;">
      <a href="https://filmfreeway.com" style="color:#5a5040;">FilmFreeway</a> · 
      <a href="https://festhome.com" style="color:#5a5040;">Festhome</a>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
