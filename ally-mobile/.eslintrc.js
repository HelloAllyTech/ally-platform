module.exports = {
  root: true,
  ignorePatterns: ['**/__mocks__/**', '**/__tests__/**', 'coverage/**'],
  extends: ['@react-native', 'prettier'],
  plugins: ['prettier', 'import', 'unused-imports'],

  rules: {
    'prettier/prettier': 'error',

    // TypeScript
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
    ],
    'unused-imports/no-unused-imports': 'error',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',

    // General best practices
    'no-console': ['warn', {allow: ['warn', 'error']}],
    eqeqeq: ['error', 'always'], // enforce === instead of ==
    'no-duplicate-imports': 'error',
    'no-shadow': 'off', // disabled due to false positives with enums
    'no-undef': 'off', // handled by TS

    // React-specific
    'react/react-in-jsx-scope': 'off', // not needed in React 17+
    'react/jsx-boolean-value': ['warn', 'never'],
    'react/jsx-curly-spacing': ['error', {when: 'never', children: true}],
    'react/self-closing-comp': 'warn',
    'react/jsx-no-duplicate-props': 'error',

    // Import organization
    'import/order': [
      'error',
      {
        groups: [
          'builtin', // Built-in Node.js modules
          'external', // Third-party libraries (npm)
          'internal', // App-specific modules using @ alias
          ['parent', 'sibling'], // Relative imports
        ],
        pathGroups: [
          {
            pattern: 'react',
            group: 'external',
            position: 'before',
          },
          {
            pattern: '@/**',
            group: 'internal',
          },
        ],
        'newlines-between': 'always',
        alphabetize: {
          caseInsensitive: true,
        },
      },
    ],
  },
};
