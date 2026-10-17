import type { Route } from "../src/db.js";
let n = 0;
export const route = (p: Partial<Route>): Route => ({
  id: ++n, name: "r" + n, matchType: "recipient", pattern: "", order: 100, gotifyUrl: null,
  gotifyToken: "tok", gotifyPriority: 5, enabled: true, targetType: "gotify", target: {}, secrets: {}, ...p,
});
