// ESLint flat config (Phase 1 upgrade — the project previously had no
// lint at all). Uses the official Next.js presets via FlatCompat:
// core-web-vitals (React/Next correctness) + the TypeScript preset.
// Rule posture: correctness rules are errors; stylistic noise that this
// codebase intentionally uses (e.g. `any` at provider API boundaries,
// unescaped entities in copy) is downgraded with the reason recorded
// here rather than silently disabled project-wide.
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({
  baseDirectory: path.dirname(fileURLToPath(import.meta.url)),
});

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      ".data/**",
      "public/sw.js",
      "scripts/**",
      "tests/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Provider payloads (Stripe/PayPal/Meta) are untyped JSON at the
      // boundary by design; the code narrows them field-by-field.
      "@typescript-eslint/no-explicit-any": "off",
      // Copy strings legitimately contain apostrophes/quotes.
      "react/no-unescaped-entities": "off",
      // Exhaustive-deps warnings are reviewed manually; several effects
      // deliberately key on a subset (documented at each call site).
      "react-hooks/exhaustive-deps": "warn",
      // Underscore-prefixed parameters are deliberately unused (stable
      // function signatures kept for callers/tests).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];

export default config;
