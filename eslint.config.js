import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "data"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["public/**/*.js"],
    languageOptions: { globals: { document: "readonly", window: "readonly", fetch: "readonly", alert: "readonly", confirm: "readonly", prompt: "readonly", setInterval: "readonly", setTimeout: "readonly", clearTimeout: "readonly", location: "readonly", URLSearchParams: "readonly", URL: "readonly", Blob: "readonly", HTMLButtonElement: "readonly", HTMLImageElement: "readonly", HTMLFormElement: "readonly", MutationObserver: "readonly", history: "readonly", localStorage: "readonly", matchMedia: "readonly", navigator: "readonly", Intl: "readonly" } },
  },
  {
    // app.js and wizard.js are classic scripts sharing one global scope
    files: ["public/app.js"], languageOptions: { globals: { startWizard: "readonly" } },
  },
  {
    files: ["public/wizard.js"],
    languageOptions: { globals: Object.fromEntries(["$", "$$", "esc", "api", "run", "toast", "field", "fieldInput", "readFields", "MATCH", "ME", "STATUS", "applyTheme", "boot", "confirmDlg", "destTypes", "emptyState", "isAdmin", "icon", "SERVICE_ICON", "SERVICE_LIST", "servicePicker", "brandHtml", "appName"].map((g) => [g, "writable"])) },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^(startWizard|validateForm)$" }] },
  },
);
