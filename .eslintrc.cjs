module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
    worker: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', 'node_modules/', '*.config.js', '*.config.cjs'],
  rules: {
    'no-console': 'off',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-control-regex': 'off',
    'no-undef': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
