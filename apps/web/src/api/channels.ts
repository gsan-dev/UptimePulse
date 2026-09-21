import { apiFetch } from "./client";
import type { ApiNotificationChannel } from "./types";

// "sms"/"email" existen en el enum de la base de datos pero no se pueden
// crear desde aquí todavía (ver ADR de la Fase 3.2 en TASK.md).
export type NotificationChannelType = "discord" | "slack" | "webhook";

export interface CreateChannelInput {
  type: NotificationChannelType;
  name: string;
  config: Record<string, string>;
}

export interface TestChannelResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

export function listChannels(): Promise<ApiNotificationChannel[]> {
  return apiFetch<ApiNotificationChannel[]>("/notification-channels");
}

export function createChannel(input: CreateChannelInput): Promise<ApiNotificationChannel> {
  return apiFetch<ApiNotificationChannel>("/notification-channels", { method: "POST", body: input });
}

export function deleteChannel(id: string): Promise<void> {
  return apiFetch<void>(`/notification-channels/${id}`, { method: "DELETE" });
}

export function testChannel(id: string): Promise<TestChannelResult> {
  return apiFetch<TestChannelResult>(`/notification-channels/${id}/test`, { method: "POST" });
}

export function listMonitorChannelIds(monitorId: string): Promise<string[]> {
  return apiFetch<string[]>(`/monitors/${monitorId}/notification-channels`);
}

export function attachChannelToMonitor(monitorId: string, channelId: string): Promise<void> {
  return apiFetch<void>(`/monitors/${monitorId}/notification-channels/${channelId}`, { method: "POST" });
}

export function detachChannelFromMonitor(monitorId: string, channelId: string): Promise<void> {
  return apiFetch<void>(`/monitors/${monitorId}/notification-channels/${channelId}`, { method: "DELETE" });
}
