export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.GROQ_API_KEY;

  const feeds = [
    { url: 'https://variety.com/feed/', source: 'Variety' },
    { url: 'https://www.indiewire.com/feed/', source: 'IndieWire' },
    { url: 'https://www.screendaily.com/rss', source: 'Screen Daily' },
    { url: 'https://cineuropa.org/en/rss/', source: 'Cineuropa' },
    { url: 'https://mubi.com/notebook/posts.atom', source: 'MUBI Notebook' },
  ];

  const cutoff = Date.now() - 48 * 60 * 60 * 1000;

  try {
    const results = await Promise.allSettled(feeds.map(f => fetchRSS(f)));
    let allItems = [];
    results.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });

    const filmKeywords = ['film', 'movie', 'cinema', 'festival', 'cannes', 'director',
      'actor', 'documentary', 'premiere', 'streaming', 'award', 'palme', 'oscar',
      'auteur', 'foreign', 'animation', 'arthouse', 'criterion'];

    let filtered = allItems.filter(item => {
      if (item.pubDate && new Date(item.pubDate).getTime() < cutoff) return false;
      const text = (item.title + ' ' + (item.description || '')).toLowerCase();
      return filmKeywords.some(k => text.includes(k));
    });

    filtered.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
    filtered = filtered.slice(0, 12);
    if (filtered.length < 4) {
      allItems.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
      filtered = allItems.slice(0, 12);
    }
    if (!filtered.length) return res.status(200).json({ articles: [] });

    const articlesText = filtered.map((item, i) =>
      `[${i}] FUENTE: ${item.source} | TÍTULO: ${item.title} | DESC: ${(item.description || '').slice(0, 300)} | URL: ${item.link || ''} | FECHA: ${item.pubDate || ''}`
    ).join('\n\n');

    const prompt = `Eres periodista de cine. Traduce estas noticias al español.

${articlesText}

Responde SOLO con JSON válido sin backticks:
{"articles":[{"index":0,"titleEs":"...","summaryEs":"2-3 frases en español","category":"Industria|Festivales|Estrenos|Cine de Autor|Premios|Latinoamérica|Cine Asiático|Cine Europeo|Documental","source":"...","sourceUrl":"...","pubDate":"...","imageUrl":""}]}

El artículo más importante lleva "featured":true. Solo uno puede ser featured. Traduce TODOS.`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 3000, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
    });

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.articles) {
      parsed.articles = parsed.articles.map(a => ({ ...a, imageUrl: filtered[a.index]?.imageUrl || '' }));
    }
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

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
    const mediaMatch = itemXml.match(/media:content[^>]+url="([^"]+)"/i) || itemXml.match(/enclosure[^>]+url="([^"]+)"/i) || itemXml.match(/<img[^>]+src="([^"]+)"/i);
    if (mediaMatch) imageUrl = mediaMatch[1];
    const title = get('title');
    const link = (get('link') || itemXml.match(/<link>([^<]+)<\/link>/i)?.[1] || '').trim();
    const description = get('description').replace(/<[^>]+>/g, '').slice(0, 400);
    const pubDate = get('pubDate');
    if (title) items.push({ title, link, description, pubDate, imageUrl, source: feedConfig.source });
  }
  return items;
}
