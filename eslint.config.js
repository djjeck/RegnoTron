import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';

const PARENT_IMPORTS = {
  group: ['../*', '../**'],
  message:
    "Use the module's #src/* alias, or another module's name, for cross-directory imports. Keep ./foo for same-directory imports.",
};

/** Production code never depends on test code, so it can be shipped without it. */
const TEST_IMPORTS = {
  regex: '^(#test/|@[\\w-]+/[\\w-]+/test/)',
  message: 'Only tests may import the test helpers.',
};

/**
 * A module has no npm dependencies of its own (MegaBotTron1999's bot-os.md D49): its code imports
 * only Node, the shell (`@megabottron1999/*`), zod and other modules (`@regnotron/*`, and the
 * InventoryBot wiki's grammar, `@inventorybot-wiki/grammar`, vendored), besides its own files. `test/modules.test.ts` checks the same, and that each module declares the modules it
 * imports in its `module.json`.
 */
const FOREIGN_IMPORTS = {
  regex:
    '^(?!node:|@megabottron1999/|@regnotron/|@inventorybot-wiki/grammar$|zod$|#src/|#test/|\\./|vitest$)',
  message:
    'A module imports only node:*, @megabottron1999/*, zod, @regnotron/* and @inventorybot-wiki/grammar (D49).',
};

/** RegnoTron plays nothing: no module imports the shell's actors. */
const ACTOR_IMPORTS = {
  regex: '^@megabottron1999/turns/turn-actor\\.ts$',
  message: 'RegnoTron has no automation: it imports no actor.',
};

const TESTS = ['**/*.test.ts'];

/** The rule with the given patterns, `../` always among them. */
const restrict = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns: [PARENT_IMPORTS, ...patterns] }],
});

export default tseslint.config(
  // Coverage reports, git-ignored (the flat config does not read .gitignore), and the shell,
  // vendored as a submodule and linted by its own repository.
  { ignores: ['coverage/', 'vendor/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      // Only dead imports are removed automatically; other unused code is left to review.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
      'import/consistent-type-specifier-style': ['error', 'prefer-inline'],
      'import/no-duplicates': ['error', { 'prefer-inline': true }],
      'unused-imports/no-unused-imports': 'error',
      ...restrict(),
      // One group, so autofix never inserts blank lines between categories: packages, then
      // the #src and #test aliases, then relative imports, then side-effect imports.
      'simple-import-sort/imports': [
        'error',
        { groups: [['^@?\\w', '^#src(?:/.*|$)', '^#test(?:/.*|$)', '^\\.', '^\\u0000']] },
      ],
      'simple-import-sort/exports': 'error',
    },
  },
  // The modules' production code: no test helpers, no actor, nothing outside D49's list.
  {
    files: ['modules/*/src/**/*.ts'],
    ignores: TESTS,
    rules: restrict(TEST_IMPORTS, ACTOR_IMPORTS, FOREIGN_IMPORTS),
  },
  // Their tests and helpers: the same, but the helpers and Vitest.
  {
    files: ['modules/*/src/**/*.test.ts', 'modules/*/test/**/*.ts'],
    rules: restrict(ACTOR_IMPORTS, FOREIGN_IMPORTS),
  }
);
