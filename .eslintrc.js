module.exports = {
  root: true,
  extends: ['@react-native', 'prettier'],
  plugins: ['prettier', 'import'],

  rules: {
    'prettier/prettier': 'error',

    // TypeScript
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
    ],
    '@typescript-eslint/explicit-function-return-type': 'off', // enable if you want strict return types
    '@typescript-eslint/no-explicit-any': 'warn', // warn when using 'any'

    // General best practices
    'no-console': ['warn', {allow: ['warn', 'error']}],
    eqeqeq: ['error', 'always'], // enforce === instead of ==
    'no-duplicate-imports': 'error',
    'no-shadow': 'warn',
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
          'index', // Index files
          'type', // Type imports
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
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
  },
};
