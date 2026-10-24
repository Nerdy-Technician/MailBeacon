/** Process-wide counters exposed on /metrics in the Prometheus text format. No labels carry secrets. */
export const counters = {
  received: 0,
  delivered: 0,
  deliveryFailures: 0,
  deadLettered: 0,
  rejected: new Map<string, number>(),
  connections: 0,
  activeConnections: 0,
};
export const startedAt = Date.now();

export function countReject(reason: string) { counters.rejected.set(reason, (counters.rejected.get(reason) ?? 0) + 1); }

export function resetCounters() {
  counters.received = counters.delivered = counters.deliveryFailures = counters.deadLettered = 0;
  counters.connections = counters.activeConnections = 0;
  counters.rejected.clear();
}

export interface Gauges { queue: Record<string, number>; routes: number; selfTestOk: boolean | null; dryRun: boolean; version: string; destinations?: number; users?: number; targetFailures?: [string, number][] }

export function renderMetrics(g: Gauges): string {
  const out: string[] = [];
  const metric = (name: string, type: string, help: string, rows: [string, number][]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, v] of rows) out.push(`${name}${labels} ${v}`);
  };
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  metric("mailbeacon_info", "gauge", "Build information.", [[`{version="${esc(g.version)}",dry_run="${g.dryRun}"}`, 1]]);
  metric("mailbeacon_uptime_seconds", "gauge", "Seconds since the process started.", [["", Math.round((Date.now() - startedAt) / 1000)]]);
  metric("mailbeacon_messages_received_total", "counter", "Messages accepted over SMTP or the test endpoint.", [["", counters.received]]);
  metric("mailbeacon_deliveries_total", "counter", "Successful notification deliveries.", [["", counters.delivered]]);
  metric("mailbeacon_delivery_failures_total", "counter", "Failed delivery attempts.", [["", counters.deliveryFailures]]);
  metric("mailbeacon_dead_letters_total", "counter", "Messages moved to the dead-letter list.", [["", counters.deadLettered]]);
  metric("mailbeacon_smtp_rejected_total", "counter", "SMTP commands rejected, by reason.",
    [...counters.rejected.entries()].map(([r, n]) => [`{reason="${esc(r)}"}`, n] as [string, number]));
  metric("mailbeacon_smtp_connections_total", "counter", "SMTP connections accepted.", [["", counters.connections]]);
  metric("mailbeacon_smtp_active_connections", "gauge", "Open SMTP connections.", [["", counters.activeConnections]]);
  metric("mailbeacon_messages", "gauge", "Stored messages by status.", Object.entries(g.queue).map(([s, n]) => [`{status="${s}"}`, n] as [string, number]));
  metric("mailbeacon_routes", "gauge", "Configured routes.", [["", g.routes]]);
  if (g.destinations !== undefined) metric("mailbeacon_destinations", "gauge", "Saved destinations.", [["", g.destinations]]);
  if (g.users !== undefined) metric("mailbeacon_users", "gauge", "User accounts.", [["", g.users]]);
  if (g.targetFailures) metric("mailbeacon_target_consecutive_failures", "gauge", "Consecutive delivery failures per target.", g.targetFailures.map(([k, n]) => [`{target="${esc(k)}"}`, n] as [string, number]));
  metric("mailbeacon_selftest_ok", "gauge", "1 if the last startup self-test passed, 0 if not, -1 if not run.", [["", g.selfTestOk === null ? -1 : g.selfTestOk ? 1 : 0]]);
  return out.join("\n") + "\n";
}
