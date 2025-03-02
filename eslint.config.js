import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier'; // Prettier 插件
import prettierConfig from 'eslint-config-prettier'; // 关闭冲突规则

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ['**/*.{js,mjs,cjs,ts}'] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  // eslintRecommended,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      './.eslintrc.js',
      './.prettierrc.js',
      './.gitignore',
    ],
    plugins: {
      prettier: prettierPlugin, // 注册 Prettier 插件
    },
    rules: {
      ...prettierConfig.rules, // 关闭冲突的 ESLint 规则
      'prettier/prettier': 'error', // 启用 Prettier 规则
    },
  },
  // 4. 自定义规则
  {
    rules: {
      'no-console': 'error',
    },
  },
];
