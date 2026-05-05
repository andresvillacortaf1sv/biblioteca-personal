export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });

  const { emails, subject, html } = req.body || {};
  if (!emails?.length || !subject || !html) {
    return res.status(400).json({ error: 'Faltan campos: emails, subject, html' });
  }

  try {
    // Send to each email individually
    const results = await Promise.allSettled(
      emails.map(email =>
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            from: 'Espacio Cinéfilo <onboarding@resend.dev>',
            to: [email],
            subject: subject,
            html: html,
          }),
        }).then(r => r.json())
      )
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return res.status(200).json({
      success: true,
      sent,
      failed,
      message: `Enviado a ${sent} destinatario${sent !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} fallaron` : ''}`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
