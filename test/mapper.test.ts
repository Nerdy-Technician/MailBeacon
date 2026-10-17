import { describe, expect, it } from "vitest";
import { htmlToMarkdown, mapMail } from "../src/mapper.js";

describe("message mapping", () => {
  it("prefers the text part", () => {
    expect(mapMail("Hi", "plain body", "<b>x</b>")).toEqual({ title: "Hi", message: "plain body", contentType: "text/plain" });
  });
  it("converts HTML to markdown and strips scripts/styles", () => {
    const m = mapMail("Job", undefined, "<html><head><style>p{}</style></head><body><h1>Backup</h1><p>Status: <b>OK</b></p><script>alert(1)</script><ul><li>a</li></ul></body></html>");
    expect(m.contentType).toBe("text/markdown");
    expect(m.message).toContain("# Backup");
    expect(m.message).toContain("**OK**");
    expect(m.message).not.toContain("alert");
    expect(m.message).not.toContain("<");
  });
  it("handles missing subject and body, and truncates", () => {
    expect(mapMail(undefined, "", false).title).toBe("(no subject)");
    expect(mapMail("x", "", false).message).toBe("(empty message)");
    expect(mapMail("x", "a".repeat(100), false, 10).message).toMatch(/truncated/);
  });
  it("converts links", () => {
    expect(htmlToMarkdown('<a href="https://x.y">link</a>')).toBe("[link](https://x.y)");
  });
});
