import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.cjs',
      '**/postcss.config.mjs',
      '**/playwright.config.ts',
      '**/e2e/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      'apps/web/.next/types/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  prettierRecommended,
  {
    files: ['**/*.module.ts'],
    rules: {
      // NestJS module classes are decorator-driven and intentionally "empty".
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      'prettier/prettier': 'error',
    },
  },
);
