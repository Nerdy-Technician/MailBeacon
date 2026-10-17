import type { Store } from "./db.js";
import { sendToTarget } from "./targets.js";

export const MAX_ATTEMPTS = 5;

export async function deliver(store: Store, messageId: number): Promise<boolean> {
  const m = store.getMessage(messageId);
  if (!m) return false;
  const route = m.routeId ? store.getRoute(m.routeId) : undefined;
  if (!route) { store.markMessage(m.id, "failed", "route no longer exists"); return false; }
  try {
    await sendToTarget(route, store.gotifyUrl, { title: m.title, message: m.body, contentType: m.contentType });
    store.markMessage(m.id, "delivered", null);
    store.log("info", `message ${m.id} delivered via route "${route.name}" (${route.targetType})`);
    return true;
  } catch (e) {
    const err = (e as Error).message;
    store.markMessage(m.id, "failed", err);
    store.log("error", `message ${m.id} failed via route "${route.name}": ${err}`);
    return false;
  }
}

/** Retry failed messages periodically with a cap on attempts. */
export function startRetryLoop(store: Store, everyMs = 60000): NodeJS.Timeout {
  const t = setInterval(async () => {
    for (const m of store.failedMessages(MAX_ATTEMPTS)) await deliver(store, m.id);
  }, everyMs);
  t.unref();
  return t;
}
