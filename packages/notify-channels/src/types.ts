// Los tres tipos de canal que esta sesión implementa de verdad (Fase 3.2).
// "sms" y "email" existen en el enum de la base de datos (channel_type,
// Fase 0.3) pero no aquí: SMS queda pendiente de credenciales reales de
// Twilio, y email ya tiene su propio mecanismo dedicado (packages/mailer,
// Fase 1.5), enviado siempre a los miembros de la organización sin pasar
// por este paquete.
export type NotificationChannelType = "webhook" | "slack" | "discord";

/**
 * Mensaje ya renderizado, independiente del canal — quien construye el
 * evento (el worker, en apps/worker/src/lib/notifications.ts) decide UNA
 * vez el título/descripción/tono, y cada sender de este paquete lo traduce
 * a su propio formato (embed de Discord, texto de Slack, JSON firmado para
 * un webhook genérico). Evita repetir "cómo describo una caída" en tres
 * sitios distintos.
 */
export interface ChannelMessage {
  title: string;
  description: string;
  tone: "down" | "up" | "warning";
  fields?: { name: string; value: string }[];
}

export interface ChannelSendResult {
  ok: boolean;
  error?: string;
  /** Confirmación específica del proveedor cuando la hay (p. ej. el id del mensaje creado en Discord). */
  detail?: string;
}
