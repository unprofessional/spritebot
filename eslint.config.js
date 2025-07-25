// eslint.config.js (CommonJS)
const parserTs = require('@typescript-eslint/parser');
const pluginTs = require('@typescript-eslint/eslint-plugin');
const importPlugin = require('eslint-plugin-import');
const jsdocPlugin = require('eslint-plugin-jsdoc');
const prettierConfig = require('eslint-config-prettier');

/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: parserTs,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: process.cwd(),
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
    },
    plugins: {
      '@typescript-eslint': pluginTs,
      import: importPlugin,
      jsdoc: jsdocPlugin,
    },
    rules: {
      // TS + Prettier
      ...pluginTs.configs.recommended.rules,
      ...prettierConfig.rules,

      // Noise reduction
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',

      '@typescript-eslint/no-require-imports': 'off', // 👈 Allow CommonJS `require()`

      // JSDoc
      'jsdoc/check-param-names': 'warn',
      'jsdoc/no-undefined-types': 'off',

      // Import handling
      'import/no-unresolved': 'off',
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'ignore',
        },
      ],
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {},
  },
];
