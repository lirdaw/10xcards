// Config composition goes through `defineConfig` from @eslint/config-helpers, not through
// `tseslint.config`. Until C10X-43 this file carried the opposite rationale in an
// `eslint-disable @typescript-eslint/no-deprecated` — "tseslint.config() is the only way to use
// extends; core defineConfig has incompatible API". Measured against the installed versions
// (eslint 9.39.4, typescript-eslint 8.59.2, @eslint/config-helpers): both halves are false.
// `defineConfig` types `extends` natively (`ConfigWithExtends.extends?: ExtendsElement[]`, whose
// element may be a string, a config object, or an arbitrarily nested array — which is what
// `tseslint.configs.strictTypeChecked` is), and the migration is behaviour-neutral, proved by a
// byte-identical `eslint --print-config` across a `.ts`, a `.tsx`, an `.astro` and this `.js`
// file itself. Every `tseslint.config(...)` call site raised `ts(6387)`: the variadic overload
// `(...configs: InfiniteDepthConfigWithExtends[]): ConfigArray` is deprecated, and a single-object
// call resolves to it too — so all four hints came from one signature, not from four spellings.
// `tseslint` is still imported: it owns the shared rule presets this file extends.
import { defineConfig, includeIgnoreFile } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginPlaywright from "eslint-plugin-playwright";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = defineConfig({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = defineConfig({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [pluginReact.configs.flat.recommended],
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
  },
});

const astroConfig = defineConfig({
  files: ["**/*.astro"],
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
  },
});

// The `/10x-e2e` anti-patterns, lint-enforced instead of review-enforced. `tests/e2e/**` already
// sits under the full type-aware `strictTypeChecked` above and inside `npm run typecheck`; only
// the Playwright-specific rules were missing.
//
// SCOPED on purpose. The plugin's `flat/recommended` ships with NO `files` key of its own, so
// spreading it unscoped would point Playwright rules at every Vitest file under `tests/`, where
// `test` and `expect` mean something else entirely.
//
// SIX RULES ARE ESCALATED TO `error`, and the reason is measured rather than stylistic: `npm run
// lint` is a bare `eslint .` with no `--max-warnings`, so it exits **0** on any number of warnings
// — the same fact `tests/lib/no-logging.test.ts:11-13` records about `no-console`, and the reason
// that guard exists as a test rather than as a lint rule. A rule left at the plugin's default
// `warn` is therefore documentation, not a gate. Each of the six carries a rule this project had
// already written down somewhere it could not enforce.
//
// What this buys and what it does NOT: the layer's SOURCE is now lint-checked in CI (`npm run
// lint` is a fail-closed `ci` step), while the layer itself still never runs there. Linting a
// spec is not executing a journey — test-plan.md §5 keeps e2e a non-gate, and this does not
// soften it.
const playwrightConfig = defineConfig({
  files: ["tests/e2e/**/*.ts"],
  extends: [pluginPlaywright.configs["flat/recommended"]],
  rules: {
    // CLAUDE.md, verbatim: "Never `page.waitForTimeout()`. Wait for state."
    "playwright/no-wait-for-timeout": "error",
    // The same rule's positive half — `waitForSelector` is the pre-locator waiting API that
    // CLAUDE.md routes around via `toBeVisible()` / `waitForURL()` / `waitForResponse()`.
    "playwright/no-wait-for-selector": "error",
    // CLAUDE.md's locator rule — `getByRole` / `getByLabel` / `getByText` first, never DOM
    // structure. Element handles and the selector-taking `page.*` methods are the escape hatch
    // it forbids, and they are how a CSS selector gets back in.
    "playwright/no-element-handle": "error",
    "playwright/prefer-locator": "error",
    // A skipped spec is invisible, which is the false-green class this project treats as worse
    // than a red (test-plan.md §6.6 passim; the same reason `it.skip()` is barred elsewhere).
    "playwright/no-skipped-test": "error",
    // …and a spec that asserts nothing is a green that proves nothing — the same class reached
    // from the other side.
    "playwright/expect-expect": "error",
  },
});

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  { ignores: ["src/db/database.types.ts"] },
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  playwrightConfig,
  eslintPluginPrettier,
);
