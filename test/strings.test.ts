import { describe, expect, it } from "vitest";
import { stripSlashes, trimBoth } from "../src/strings.js";
import { extractValues } from "../src/format.js";

describe("linear-time trims", () => {
  it("strips trailing slashes only", () => {
    expect(stripSlashes("https://a.example///")).toBe("https://a.example");
    expect(stripSlashes("/".repeat(100000) + "x")).toHaveLength(100001);
    expect(trimBoth("__a_b__", "_")).toBe("a_b");
  });
  it("extraction names cannot touch the prototype", () => {
    const out = extractValues([{ kind: "regex", field: "subject", pattern: "(?<__proto__>\\w+)" } as never], "polluted", "");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBeNull();
  });
});
