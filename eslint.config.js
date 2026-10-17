import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "data"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["public/**/*.js"],
    languageOptions: { globals: { document: "readonly", window: "readonly", fetch: "readonly", alert: "readonly", confirm: "readonly", prompt: "readonly", setInterval: "readonly", setTimeout: "readonly", clearTimeout: "readonly", location: "readonly", URLSearchParams: "readonly" } },
  },
);
