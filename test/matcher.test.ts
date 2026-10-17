import { describe, expect, it } from "vitest";
import { canAcceptRecipient, matchRoute, recipientMatches } from "../src/matcher.js";
import { route } from "./helpers.js";

describe("route matching", () => {
  const px = route({ name: "proxmox", pattern: "proxmox@alerts.local", order: 10 });
  const bk = route({ name: "backups", pattern: "backups@alerts.local", order: 20 });
  const snd = route({ name: "nas", matchType: "sender", pattern: "^nas@", order: 30 });
  const subj = route({ name: "urgent", matchType: "subject", pattern: "urgent|critical", order: 5 });
  const all = route({ name: "default", matchType: "catchall", order: 999 });

  it("matches recipient case-insensitively", () => {
    expect(matchRoute([px, bk], { sender: "a@b", recipients: ["Proxmox@Alerts.local"] })?.name).toBe("proxmox");
    expect(matchRoute([px, bk], { sender: "a@b", recipients: ["backups@alerts.local"] })?.name).toBe("backups");
  });
  it("supports recipient globs", () => {
    expect(recipientMatches("*@alerts.local", "x@alerts.local")).toBe(true);
    expect(recipientMatches("*@alerts.local", "x@alerts.localhost")).toBe(false);
  });
  it("matches sender regex", () => {
    expect(matchRoute([px, snd], { sender: "nas@home", recipients: ["z@z"] })?.name).toBe("nas");
  });
  it("respects order and subject only after DATA", () => {
    const env = { sender: "a@b", recipients: ["proxmox@alerts.local"], subject: "CRITICAL disk" };
    expect(matchRoute([px, subj], env)?.name).toBe("proxmox");
    expect(matchRoute([px, subj], env, { includeSubject: true })?.name).toBe("urgent");
  });
  it("falls back to catch-all", () => {
    expect(matchRoute([px, all], { sender: "a@b", recipients: ["nope@x"] })?.name).toBe("default");
  });
  it("skips disabled routes and bad regex", () => {
    const off = route({ pattern: "proxmox@alerts.local", enabled: false });
    const bad = route({ matchType: "sender", pattern: "([" });
    expect(matchRoute([off, bad], { sender: "a@b", recipients: ["proxmox@alerts.local"] })).toBeUndefined();
  });
});

describe("open relay protection", () => {
  const px = route({ pattern: "proxmox@alerts.local" });
  it("rejects unmatched recipient with no catch-all", () => {
    expect(canAcceptRecipient([px], "a@b", "victim@gmail.com")).toBe(false);
    expect(canAcceptRecipient([], "a@b", "anything@x")).toBe(false);
  });
  it("accepts matched recipient", () => {
    expect(canAcceptRecipient([px], "a@b", "proxmox@alerts.local")).toBe(true);
  });
  it("accepts anything with a catch-all", () => {
    expect(canAcceptRecipient([px, route({ matchType: "catchall" })], "a@b", "x@y")).toBe(true);
  });
});

describe("testPattern", () => {
  it("handles each match type", async () => {
    const { testPattern } = await import("../src/matcher.js");
    expect(testPattern("recipient", "Proxmox@Alerts.local", "proxmox@alerts.local").matches).toBe(true);
    expect(testPattern("recipient", "*@alerts.local", "a@b.c").matches).toBe(false);
    expect(testPattern("sender", "^nas@", "nas@home").matches).toBe(true);
    expect(testPattern("subject", "[", "x")).toMatchObject({ valid: false, matches: false });
    expect(testPattern("sender", "", "x").valid).toBe(false);
    expect(testPattern("catchall", "", "x").matches).toBe(true);
  });
});
