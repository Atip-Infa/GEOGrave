// ESLint 9 flat config
'use strict'

const js = require('@eslint/js')

const nodeGlobals = {
  process: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  console: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URL: 'readonly',
}

const testGlobals = {
  describe: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  jest: 'readonly',
}

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  performance: 'readonly',
  FileReader: 'readonly',
  DataTransfer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  FormData: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  HTMLElement: 'readonly',
  AbortController: 'readonly',
  history: 'readonly',
  location: 'readonly',
}

// Caught error variable names that are intentionally unused (try/catch for side-effects)
const caughtIgnore = '^e$|^err$|^_'

module.exports = [
  js.configs.recommended,
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  {
    // The config file itself is a CJS Node file
    files: ['eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
  },
  {
    // Server-side CommonJS files
    files: ['server.js', 'lib/**/*.js', 'middleware/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_|^next$',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: caughtIgnore,
      }],
      'no-undef': 'error',
      'no-console': 'off',
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Control characters are used intentionally in sanitizeOriginalName() in server.js
      'no-control-regex': 'off',
      'prefer-const': 'warn',
      'no-var': 'warn',
    },
  },
  {
    // Frontend ES modules served to the browser
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: caughtIgnore,
      }],
      'no-undef': 'error',
      'no-console': 'off',
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'prefer-const': 'warn',
      'no-var': 'warn',
    },
  },
  {
    // Test files
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...nodeGlobals, ...testGlobals },
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_|^next$',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: caughtIgnore,
      }],
      'no-undef': 'error',
      'no-console': 'off',
      'eqeqeq': ['error', 'always'],
      'prefer-const': 'warn',
      'no-var': 'warn',
    },
  },
]
