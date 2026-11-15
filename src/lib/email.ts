import nodemailer, { type Transporter } from 'nodemailer';

let transport: Transporter | null = null;

// Parses MAIL_FROM like: Otter & Oyster <no-reply@example.com>
function parseFrom(): { name: string; email: string } {
  const raw = process.env.MAIL_FROM || 'no-reply@localhost';
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: raw.trim() };
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  // Preferred on hosts that block SMTP ports: Brevo's web API (plain HTTPS).
  const brevoKey = process.env.BREVO_API_KEY;
  if (brevoKey) {
    const from = parseFrom();
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: from.name ? { name: from.name, email: from.email } : { email: from.email }, to: [{ email: to }], subject, textContent: text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Brevo API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }

  const host = process.env.SMTP_HOST;
  if (!host) {
    // Development fallback: no mail service configured, so print the message where you can copy the link.
    console.log(`\n[dev mail] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  transport ??= nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  });
  await transport.sendMail({ from: process.env.MAIL_FROM || 'no-reply@localhost', to, subject, text });
}
