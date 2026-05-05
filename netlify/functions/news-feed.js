exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    // RSS feeds from major film publications
    const feeds = [
      { url: 'https://variety.com/feed/', source: 'Variety', category: 'Industria' },
      { url: 'https://deadline.com/feed/', source: 'Deadline', category: 'Industria' },
      { url: 'https://www.indiewire.com/feed/', source: 'IndieWire', category: 'Cine Independiente' },
      { url: 'https://www.hollywoodreporter.com/feed/', source: 'The Hollywood Reporter', category: 'Industria' },
      { url: 'https://www.screendaily.com/rss', source: 'Screen Daily', category: 'Festivales' },
    ];

    const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48 hours ago

    // Fetch all feeds in parallel
    const results = await Promise.allSettled(
      feeds.map(f => fetchRSS(f))
    );

    let allItems = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        allItems.push(...r.value);
      }
    });

    // Filter to last 48 hours and film-related
    const filmKeywords = ['film', 'movie', 'cinema', 'festival', 'cannes', 'venice', 'director',
      'actor', 'actress', 'oscar', 'award', 'box office', 'premiere', 'documentary',
      'screenplay', 'streaming', 'netflix', 'release', 'trailer'];

    let filtered = allItems.filter(item => {
      if (item.pubDate && new Date(item.pubDate).getTime() < cutoff) return false;
      const text = (item.title + ' ' + item.description).toLowerCase();
      return filmKeywords.some(k => text.includes(k));
    });

    // Sort by date, take top 12
    filtered.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    filtered = filtered.slice(0, 12);

    if (filtered.length === 0) {
      // Fallback: just take most recent from all feeds regardless of date
      allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
      filtered = allItems.slice(0, 12);
    }

    // Use Groq to translate and summarize each article
    const apiKey = process.env.GROQ_API_KEY;
    const articlesText = filtered.map((item, i) =>
      `[${i}] FUENTE: ${item.source} | TÍTULO: ${item.title} | RESUMEN: ${item.description?.slice(0, 300) || 'Sin descripción'} | URL: ${item.link} | FECHA: ${item.pubDate}`
    ).join('\n\n');

    const prompt = `Eres un periodista cinematográfico. Traduce y adapta estas noticias reales de cine al español.

NOTICIAS ORIGINALES:
${articlesText}

Responde SOLO con JSON válido sin backticks:
{
  "articles": [
    {
      "index": 0,
      "titleEs": "Título traducido al español, llamativo y preciso",
      "summaryEs": "Resumen en español de 2-3 frases informativas basado en el contenido real",
      "category": "Industria|Festivales|Estrenos|Cine de Autor|Premios|Streaming",
      "source": "nombre de la fuente",
      "sourceUrl": "url original",
      "pubDate": "fecha original",
      "imageUrl": ""
    }
  ]
}

REGLAS:
- Traduce TODOS los artículos proporcionados
- No inventes información — solo traduce y resume lo que está en el original
- El primer artículo que sea más importante márcalo con "featured": true
- Solo 1 puede ser featured
- Mantén los URLs originales exactamente como están`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 3000,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const parsed = JSON.parse(cleaned);

    // Merge image URLs from original items
    parsed.articles = parsed.articles.map(a => ({
      ...a,
      imageUrl: filtered[a.index]?.imageUrl || '',
    }));

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

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

    // Extract image from media:content, enclosure, or description
    let imageUrl = '';
    const mediaMatch = itemXml.match(/media:content[^>]+url="([^"]+)"/i) ||
                       itemXml.match(/enclosure[^>]+url="([^"]+)"/i) ||
                       itemXml.match(/<img[^>]+src="([^"]+)"/i);
    if (mediaMatch) imageUrl = mediaMatch[1];

    const title = get('title');
    const link = get('link') || itemXml.match(/<link>([^<]+)<\/link>/i)?.[1] || '';
    const description = get('description').replace(/<[^>]+>/g, '').slice(0, 400);
    const pubDate = get('pubDate');

    if (title) {
      items.push({
        title,
        link: link.trim(),
        description,
        pubDate,
        imageUrl,
        source: feedConfig.source,
        category: feedConfig.category,
      });
    }
  }
  return items;
}
