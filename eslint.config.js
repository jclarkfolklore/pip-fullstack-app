// Flat config. Three environments in one repo, so they're configured
// separately rather than with a lowest-common-denominator ruleset:
//
//   server/, scripts/  CommonJS, Node globals
//   src/               ESM, browser globals (bundled by webpack)
//   tests/             ESM, Node globals
//
// Formatting rules are deliberately absent — Prettier owns those, and
// eslint-config-prettier turns off anything that would fight it. ESLint here
// is only for correctness.

const globals = require('globals');
const prettier = require('eslint-config-prettier');

const correctness = {
  // caughtErrorsIgnorePattern is separate from argsIgnorePattern in ESLint 9 —
  // without it every `catch (_)` is reported, and this codebase uses that
  // deliberately where the error genuinely doesn't matter.
  'no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_|^err$' }
  ],
  'no-undef': 'error',
  eqeqeq: ['warn', 'smart'],
  'no-var': 'error',
  'prefer-const': 'warn',
  'no-console': 'off', // the server logs to stdout on purpose
  'no-empty': ['warn', { allowEmptyCatch: true }]
};

module.exports = [
  {
    ignores: ['server/public/**', 'snapshot/**', 'node_modules/**', 'data/**', 'docs/**']
  },
  {
    files: ['server/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: correctness
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser }
    },
    rules: correctness
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: correctness
  },
  {
    // Playwright drivers: Node scripts whose page.evaluate() callbacks execute
    // in the BROWSER. Both global sets are genuinely in play in one file, so
    // this isn't laxness — it's what's actually true of these files.
    files: ['tests/e2e/**/*.mjs', 'scripts/pip-touch-test.js', 'scripts/pip-screens.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: correctness
  },
  prettier
];
