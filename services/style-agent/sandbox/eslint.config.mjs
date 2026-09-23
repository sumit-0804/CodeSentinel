import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Rules that need the whole file (undefined or unused names) are off: the agent sees hunks only.
const fragmentSafe = {
  "no-undef": "off",
  "no-unused-vars": "off",
  "no-unreachable": "off",
  "no-var": "error",
  "prefer-const": "error",
  eqeqeq: ["error", "smart"],
  "no-empty": "error",
  "no-extra-boolean-cast": "error",
};

export default [
  { files: ["work/**/*.{js,jsx,mjs,cjs}"], ...js.configs.recommended, rules: { ...js.configs.recommended.rules, ...fragmentSafe } },
  {
    files: ["work/**/*.{ts,tsx,mts,cts}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { ...js.configs.recommended.rules, ...fragmentSafe },
  },
];
