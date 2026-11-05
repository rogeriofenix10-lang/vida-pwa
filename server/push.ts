import webpush from "web-push";
import { getDb } from "./db";
import { pushSubscriptions, radarItems } from "../drizzle/schema";
import { and, eq, isNull, lte, ne, or } from "drizzle-orm";

const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
const subject = process.env.WEB_PUSH_SUBJECT;

export function isPushConfigured() {
  return Boolean(publicKey && privateKey && subject);
}

export function getPublicKey() {
  return publicKey ?? null;
}

function configurePush() {
  if (!isPushConfigured()) throw new Error("Notificações Push não configuradas");
  webpush.setVapidDetails(subject!, publicKey!, privateKey!);
}

export async function sendPendingReminder(userId: number, title: string, body?: string, now = new Date()) {
  configurePush();
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  const dueItems = await db.select().from(radarItems).where(and(
    eq(radarItems.userId, userId),
    ne(radarItems.status, "completed"),
    lte(radarItems.reminderAt, now),
    or(isNull(radarItems.lastNotifiedAt), lte(radarItems.lastNotifiedAt, new Date(now.getTime() - 15 * 60 * 1000))),
  ));
  if (!dueItems.length || !subscriptions.length) return 0;
  const reminderBody = body ?? (dueItems.length === 1 ? `Lembrete: ${dueItems[0].label}` : `Você tem ${dueItems.length} lembretes no seu Radar.`);
  const payload = JSON.stringify({ title, body: reminderBody, url: "/" });
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
      else throw error;
    }
  }));
  await Promise.all(dueItems.map((item) => db.update(radarItems).set({ lastNotifiedAt: now }).where(eq(radarItems.id, item.id))));
  return subscriptions.length;
}

export async function sendTestNotification(userId: number, title = "Iris — teste de notificação") {
  configurePush();
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  const payload = JSON.stringify({ title, body: "As notificações do Iris estão funcionando.", url: "/" });
  let sent = 0;
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
      sent += 1;
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
      else throw error;
    }
  }));
  return sent;
}
