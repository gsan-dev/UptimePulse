import nodemailer from "nodemailer";

export * from "./templates.js";

export interface MailerConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  from: string;
}

export interface SendMailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  sendMail(input: SendMailInput): Promise<void>;
}

/**
 * Crea un mailer sobre SMTP. En desarrollo apunta a Mailpit (docker-compose,
 * sin autenticación); en producción, a un proveedor real (Resend, SES...) —
 * el código que llama a sendMail() no cambia, solo la configuración que se
 * le pasa aquí (por eso recibe `config` como parámetro, no lee variables de
 * entorno ella misma: mismo patrón que assertPublicHost en server-utils).
 */
export function createMailer(config: MailerConfig): Mailer {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  return {
    async sendMail(input: SendMailInput): Promise<void> {
      await transporter.sendMail({
        from: config.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
    },
  };
}
