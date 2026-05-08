/**
 * ESLint configuration for enforcing new architecture
 */

module.exports = {
  // ... existing config ...

  rules: {
    // ... existing rules ...

    // Architecture enforcement
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['src/app/lib'],
            message:
              'Do not use src/app/lib. Use src/shared/lib instead. Consolidate utilities into src/shared.',
          },
          {
            group: ['src/lib'],
            message:
              'Do not use src/lib. Use src/shared/lib instead. Consolidate utilities into src/shared.',
          },
          {
            group: ['src/app/components/*.controller*'],
            message:
              'Business logic should be in hooks or services, not in components. Move to hooks/ folder.',
          },
          {
            group: ['src/app/components/*/*.api.ts'],
            message:
              'API logic must be in src/features/[feature]/api/. Move this file to the proper location.',
          },
        ],
      },
    ],

    // Enforce feature structure
    'import/no-relative-parent-imports': [
      'warn',
      {
        path: 'src/features',
        maxDepth: 1,
        message:
          'Avoid parent imports within features. Use absolute imports or co-locate related files.',
      },
    ],

    // Component size
    'max-lines': [
      'warn',
      {
        max: 250,
        skipBlankLines: true,
        skipComments: true,
      },
    ],

    // Hooks only for API calls
    'no-restricted-syntax': [
      'warn',
      {
        selector:
          "CallExpression[callee.object.name='httpClient'], CallExpression[callee.name='axios']",
        message:
          'Direct HTTP calls not allowed in components. Use query/mutation hooks from api/ folder.',
      },
    ],
  },

  overrides: [
    // Relax rules in tests
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
      rules: {
        'max-lines': 'off',
      },
    },

    // Strict rules for shared lib
    {
      files: ['src/shared/**'],
      rules: {
        'no-default-export': 'warn',
        'max-lines': [
          'warn',
          {
            max: 150,
          },
        ],
      },
    },

    // Enforce feature module structure
    {
      files: ['src/features/*/!(api|components|hooks|types|utils|__tests__|*.test.ts)/**'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: '*',
            message:
              'Only use: components/, hooks/, api/, types/, utils/, __tests__ folders in features.',
          },
        ],
      },
    },
  ],
};
