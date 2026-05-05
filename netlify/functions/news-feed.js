exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const feeds = [
      // Hollywood / industria general
      { url: 'https://variety.com/feed/', source: 'Variety' },
      { url: 'https://www.indiewire.com/feed/', source: 'IndieWire' },
      // Cine de autor / festivales / mundial
      { url: 'https://www.screendaily.com/rss', source: 'Screen Daily' },
      { url: 'https://cineuropa.org/en/rss/', source: 'Cineuropa' },
      { url: 'https://mubi.com/notebook/posts.atom', source: 'MUBI Notebook' },
      // Latinoamérica
      { url: 'https://www.cinesargentinos.com.ar/feed/', source: 'Cines Argentinos' },
    ];

    const cutoff = Date.now() - 48 * 60 * 60 * 1000;

    const results = await Promise.allSettled(
      feeds.map(f => fetchRSS(f))
    );

    let allItems = [];
    results.forEach(r => {
      if (r.status === 'fulfilled') allItems.push(...r.value);
    });

    // Filter: last 48h + film-related keywords
    const filmKeywords = [
      'film', 'movie', 'cinema', 'festival', 'cannes', 'venice', 'berlin', 'director',
      'actor', 'actress', 'documentary', 'premiere', 'streaming', 'release', 'screenplay',
      'pelicula', 'cine', 'director', 'cortometraje', 'latinoamerica', 'europe',
      'award', 'palme', 'oscar', 'sundance', 'tiff', 'indiewire', 'mubi', 'arthouse',
      'auteur', 'foreign', 'animation', 'shorts', 'box office', 'sequel', 'remake',
      'retrospective', 'restoration', 'criterion', 'nouvelle vague', 'neorealism'
    ];

    let filtered = allItems.filter(item => {
      const tooOld = item.pubDate && new Date(item.pubDate).getTime() < cutoff;
      if (tooOld) return false;
      const text = (item.title + ' ' + (item.description||'')).toLowerCase();
      return filmKeywords.some(k => text.includes(k));
    });

    filtered.sort((a, b) => new Date(b.pubDate||0) - new Date(a.pubDate||0));
    filtered = filtered.slice(0, 12);

    // Fallback: just take most recent
    if (filtered.length < 4) {
      allItems.sort((a, b) => new Date(b.pubDate||0) - new Date(a.pubDate||0));
      filtered = allItems.slice(0, 12);
    }

    if (!filtered.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ articles: [] }) };
    }

    // Translate & categorize with Groq
    const apiKey = process.env.GROQ_API_KEY;
    const articlesText = filtered.map((item, i) =>
      `[${i}] FUENTE: ${item.source} | TÍTULO: ${item.title} | DESCRIPCIÓN: ${(item.description||'').slice(0,300)} | URL: ${item.link||''} | FECHA: ${item.pubDate||''}`
    ).join('\n\n');

    const prompt = `Eres un periodista especializado en cine mundial: latinoamericano, europeo, asiático e industria general. Traduce y adapta estas noticias al español.

NOTICIAS ORIGINALES:
${articlesText}

Responde SOLO con JSON válido sin backticks ni texto adicional:
{
  "articles": [
    {
      "index": 0,
      "titleEs": "Título en español, llamativo y preciso",
      "summaryEs": "Resumen en 2-3 frases informativas en español, basado en el contenido real",
      "category": "Industria|Festivales|Estrenos|Cine de Autor|Premios|Latinoamérica|Cine Asiático|Cine Europeo|Documental|Streaming",
      "source": "nombre de la fuente",
      "sourceUrl": "url exacta del artículo",
      "pubDate": "fecha original",
      "imageUrl": ""
    }
  ]
}

IMPORTANTE:
- Traduce TODOS los artículos de la lista
- NO inventes información — solo traduce y resume el contenido real
- El artículo más importante va primero (será el elemento central del layout)
- Usá categorías como Cine de Autor, Latinoamérica, Cine Asiático, Cine Europeo cuando aplique
- Mantené los URLs originales exactamente`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 3000,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const parsed = JSON.parse(cleaned);

    // Merge image URLs from original items
    if (parsed.articles) {
      parsed.articles = parsed.articles.map(a => ({
        ...a,
        imageUrl: filtered[a.index]?.imageUrl || '',
      }));
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function fetchRSS(feedConfig) {
  const res = await fetch(feedConfig.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader)' },
    signal: AbortSignal.timeout(6000),
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
    let imageUrl = '';
    const mediaMatch = itemXml.match(/media:content[^>]+url="([^"]+)"/i) ||
                       itemXml.match(/enclosure[^>]+url="([^"]+)"/i) ||
                       itemXml.match(/<img[^>]+src="([^"]+)"/i);
    if (mediaMatch) imageUrl = mediaMatch[1];

    const title = get('title');
    const link = (get('link') || itemXml.match(/<link>([^<]+)<\/link>/i)?.[1] || '').trim();
    const description = get('description').replace(/<[^>]+>/g, '').slice(0, 400);
    const pubDate = get('pubDate');

    if (title) items.push({ title, link, description, pubDate, imageUrl, source: feedConfig.source });
  }
  return items;
}
