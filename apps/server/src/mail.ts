// Email (ADR 0033): the server sends mail only through the SMTP server its
// admin names, with nodemailer, and sends none when there is none. What it
// sends is plain text, which every mail client shows as written.
import nodemailer from "nodemailer";

export interface Message {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  send(message: Message): Promise<void>;
  close(): void;
}

/**
 * A mailer through the SMTP server at `url`, as `smtp://user:password@host:587`
 * (STARTTLS when the server offers it) or `smtps://…:465`, from `from`.
 */
export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
    close() {
      transport.close();
    },
  };
}
