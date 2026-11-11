/**
 * A plain-text email to the workspace owner, sent the way magic links are:
 * through EMAIL_SERVER (SMTP, Nodemailer) when it is set, otherwise through
 * Resend's REST API. Never throws: failures are logged, and without any email
 * configuration nothing is sent.
 */
import nodemailer from "nodemailer";

export async function sendOwnerEmail(to: string, subject: string, text: string): Promise<void> {
  const from = process.env.EMAIL_FROM ?? "OpenReply <login@example.com>";
  try {
    if (process.env.EMAIL_SERVER) {
      await nodemailer.createTransport(process.env.EMAIL_SERVER).sendMail({ from, to, subject, text });
      return;
    }
    if (!process.env.RESEND_API_KEY) return;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Resend answered ${response.status}: ${await response.text()}`);
  } catch (error) {
    console.error("[Email] Owner email not sent:", error instanceof Error ? error.message : error);
  }
}
