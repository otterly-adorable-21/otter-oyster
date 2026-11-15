import nodemailer, { type Transporter } from 'nodemailer';

let transport: Transporter | null = null;

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    // Development fallback: no mail server configured, so print the message where you can copy the link.
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
