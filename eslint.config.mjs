import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.data/**',
      '**/uploads/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      // 猴子补丁（fetch / XHR / console / history）必须捕获实例引用，
      // 否则回调内的 this 会指向宿主对象，这是 SDK 采集的必然写法。
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
  {
    files: ['**/*.cjs', '**/*.config.js', 'build/**/*.mjs', '**/rollup.config.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', module: 'writable' },
    },
  },
);
