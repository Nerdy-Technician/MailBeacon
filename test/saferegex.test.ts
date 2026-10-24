import { describe, expect, it } from "vitest";
import { compileSafe, patternError, trySafe } from "../src/saferegex.js";
import { extractValues, pickPriority } from "../src/format.js";
import { recipientMatches, testPattern } from "../src/matcher.js";

describe("safe regex", () => {
  it("runs catastrophic patterns in linear time", () => {
    const t = Date.now();
    expect(trySafe("(a+)+$")!.test("a".repeat(50000) + "b")).toBe(false);
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it("supports flags, groups and named groups", () => {
    const m = compileSafe("^(?<host>\\w+) is (down|up)$", { ignoreCase: true, multiline: true }).exec("x\nWeb1 is DOWN");
    expect(m?.named.host).toBe("Web1");
    expect(m?.groups[1]).toBe("DOWN");
  });
  it("rejects lookarounds and overlong patterns with a message", () => {
    expect(patternError("(?=x)")).toMatch(/unsupported/);
    expect(patternError("a".repeat(1001))).toMatch(/longer/);
    expect(testPattern("subject", "(?<=x)y", "xy").valid).toBe(false);
  });
  it("keeps extraction, priority and recipient globs working", () => {
    expect(extractValues([{ kind: "regex", field: "body", pattern: "Host: (?<host>\\S+)" } as never], "", "Host: nas01")).toEqual({ host: "nas01" });
    expect(extractValues([{ kind: "field", field: "body", pattern: "Status" } as never], "", "  * Status: degraded ")).toEqual({ status: "degraded" });
    expect(pickPriority([{ field: "subject", pattern: "FAIL", priority: 8 }], "backup failed", "")).toBe(8);
    expect(recipientMatches("*@alerts.local", "Nas@Alerts.Local")).toBe(true);
    expect(recipientMatches("a*b*c@x", "a1b2c@x")).toBe(true);
    expect(recipientMatches("ab*ba", "aba")).toBe(false);
    expect(recipientMatches("*@alerts.local", "x@alerts.local.evil")).toBe(false);
  });
});
