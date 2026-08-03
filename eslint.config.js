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

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  { ignores: ["src/db/database.types.ts"] },
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  eslintPluginPrettier,
);
