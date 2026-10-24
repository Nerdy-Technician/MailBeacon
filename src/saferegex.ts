import { RE2JS } from "re2js";

/**
 * User-supplied patterns (routes, priority and extraction rules) run on RE2 semantics: matching time is linear in the
 * input, so a pattern such as `(a+)+$` can't stall the SMTP server. Lookarounds and backreferences are not supported.
 */
export interface SafeMatch { text: string; groups: string[]; named: Record<string, string> }
export interface SafeRegex { test(s: string): boolean; exec(s: string): SafeMatch | null }

export const MAX_PATTERN_LENGTH = 1000;

export function compileSafe(pattern: string, opts: { ignoreCase?: boolean; multiline?: boolean } = {}): SafeRegex {
  if (pattern.length > MAX_PATTERN_LENGTH) throw new Error(`pattern is longer than ${MAX_PATTERN_LENGTH} characters`);
  const flags = (opts.ignoreCase ? RE2JS.CASE_INSENSITIVE : 0) | (opts.multiline ? RE2JS.MULTILINE : 0);
  let p: RE2JS;
  try { p = RE2JS.compile(pattern, flags); } catch (e) { throw new Error(String((e as Error).message).replace(/^error parsing regexp: /, ""), { cause: e }); }
  const names = p.namedGroups() as Record<string, number>;
  return {
    test: (s) => p.matcher(s).find(),
    exec: (s) => {
      const m = p.matcher(s);
      if (!m.find()) return null;
      const groups: string[] = [];
      for (let i = 1; i <= m.groupCount(); i++) groups.push(m.group(i) ?? undefined as unknown as string);
      const named: Record<string, string> = {};
      for (const [k, i] of Object.entries(names)) { const v = m.group(i); if (v != null) named[k] = v; }
      return { text: m.group(0) ?? "", groups, named };
    },
  };
}

/** Compile or return null (invalid patterns never match). */
export function trySafe(pattern: string, opts?: { ignoreCase?: boolean; multiline?: boolean }): SafeRegex | null {
  try { return compileSafe(pattern, opts); } catch { return null; }
}

/** Error message for an invalid pattern, or null when it is valid. */
export function patternError(pattern: string): string | null {
  try { compileSafe(pattern); return null; } catch (e) { return (e as Error).message; }
}
