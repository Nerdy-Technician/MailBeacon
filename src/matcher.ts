import type { MatchType, Route } from "./db.js";

export interface Envelope { sender: string; recipients: string[]; subject?: string }

const norm = (s: string) => s.trim().toLowerCase();

function safeRegex(p: string): RegExp | null {
  try { return new RegExp(p, "i"); } catch { return null; }
}

/** Recipient patterns: exact address, or a glob with * (e.g. *@alerts.local). */
export function recipientMatches(pattern: string, addr: string): boolean {
  const p = norm(pattern);
  if (!p.includes("*")) return p === norm(addr);
  const re = new RegExp("^" + p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(norm(addr));
}

/** Check one pattern against a sample, as the UI's "test this pattern" box does. */
export function testPattern(matchType: MatchType, pattern: string, sample: string): { valid: boolean; matches: boolean; error?: string } {
  if (matchType === "catchall") return { valid: true, matches: true };
  if (!pattern) return { valid: false, matches: false, error: "pattern is empty" };
  if (matchType === "recipient") return { valid: true, matches: recipientMatches(pattern, sample) };
  const re = safeRegex(pattern);
  if (!re) return { valid: false, matches: false, error: "not a valid regular expression" };
  return { valid: true, matches: re.test(sample) };
}

/**
 * Pick the first enabled route (by order) that matches. Subject routes only match once the
 * subject is known (after DATA); pass subject undefined at RCPT time.
 */
export function matchRoute(routes: Route[], env: Envelope, opts: { includeSubject?: boolean } = {}): Route | undefined {
  const sorted = routes.filter((r) => r.enabled).sort((a, b) => a.order - b.order || a.id - b.id);
  for (const r of sorted) {
    switch (r.matchType) {
      case "recipient":
        if (env.recipients.some((a) => recipientMatches(r.pattern, a))) return r;
        break;
      case "sender": {
        const re = safeRegex(r.pattern);
        if (re && re.test(env.sender)) return r;
        break;
      }
      case "subject": {
        if (!opts.includeSubject || env.subject === undefined) break;
        const re = safeRegex(r.pattern);
        if (re && re.test(env.subject)) return r;
        break;
      }
      case "catchall":
        return r;
    }
  }
  return undefined;
}

/**
 * Decide at RCPT TO whether a recipient can be accepted. Accepted if a recipient/sender route or a
 * catch-all matches, or if any subject route exists (the subject is checked after DATA and the
 * message is rejected then if nothing matches).
 */
export function canAcceptRecipient(routes: Route[], sender: string, rcpt: string): boolean {
  if (matchRoute(routes, { sender, recipients: [rcpt] })) return true;
  return routes.some((r) => r.enabled && r.matchType === "subject");
}
