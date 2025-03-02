import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    extends: [
      'eslint:recommended',
      "plugin:prettier/recommended", // 等价于同时启用 eslint-plugin-prettier + eslint-config-prettie
    ],
    rules: {
      'prettier/prettier': 'error', // 将 Prettier 错误视为 ESLint 错误
        eqeqeq: "off",
        "no-unused-vars": "error",
        "prefer-const": ["error", { "ignoreReadBeforeAssign": true }]
    }
  },
];
