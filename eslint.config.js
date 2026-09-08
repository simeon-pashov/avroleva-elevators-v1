import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/api/src/generated/**',
      'apps/api/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/office/**/*.{ts,tsx}', 'apps/tech/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Data fetching in an effect with setState in the resolved callback is the pattern used here;
      // this heuristic rule cannot see the await and flags it.
      'react-hooks/set-state-in-effect': 'off',
      // Every user-visible string goes through t(); this catches raw Cyrillic/Latin literals in JSX.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/[A-Za-zА-Яа-я]{3,}/]',
          message: 'User-visible text must go through t() (packages/i18n).',
        },
      ],
    },
  },
  {
    // Module boundary rule (ARCHITECTURE §1.1): modules import other modules only via their index.ts.
    files: ['apps/api/src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/*/repo/**', '**/modules/*/domain/**', '**/modules/*/http/**'],
              message: 'Import another module only through its index.ts (ARCHITECTURE §1.1 rule 1).',
            },
          ],
        },
      ],
    },
  },
)
