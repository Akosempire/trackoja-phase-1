module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['dist/', 'coverage/', 'node_modules/'],
  reportUnusedDisableDirectives: true,
  rules: {
    'no-debugger': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
  },
};
