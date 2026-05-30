export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { upc } = req.query;

  if (!upc || !/^\d{8,14}$/.test(upc)) {
    return res.status(400).json({ error: 'UPC inválido' });
  }

  try {
    const response = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'EspacioCinefilo/1.0'
        }
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Error consultando UPCitemdb' });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
