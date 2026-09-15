// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Flat config shared by every workspace (`"lint": "eslint src"`).
 * Recommended rules only, not type-checked, so linting needs no TypeScript project and stays fast.
 */
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "docs/**"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        // Destructuring a field away (`const { id: _id, ...rest }`) is how services strip fields.
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      // Services log through their logger so secrets are redacted (NFR-05).
      "no-console": "error",
    },
  },
);
