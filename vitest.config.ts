import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** The modules: each directory of `modules/` with a `module.json`. */
function modules(root = import.meta.dirname): string[] {
  const dir = path.join(root, 'modules');
  return fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'module.json')))
    .map((d) => `modules/${d}`);
}

const PER_MODULE = { statements: 90, branches: 90, functions: 90, lines: 90 };

export default defineConfig({
  test: {
    // The modules' tests and the root's checks; the shell's own tests run in its repository.
    include: ['modules/*/src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: modules().map((m) => `${m}/src/**/*.ts`),
      exclude: ['**/*.test.ts'],
      // The rule holds for the whole and for each module (CLAUDE.md), so that a module's own
      // tests keep it covered.
      thresholds: {
        ...PER_MODULE,
        ...Object.fromEntries(modules().map((m) => [`${m}/src/**/*.ts`, PER_MODULE])),
      },
    },
  },
});
