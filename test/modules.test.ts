/**
 * The modules keep MegaBotTron1999's module format (its docs/bot-os.md D49): each directory of
 * `modules/` has a `module.json` that names it, the import name it provides and the modules it
 * imports, and its plugin entry points; it is also a workspace package of the same name and
 * version, with no npm dependencies; and its code imports only Node, the shell, zod, its own files
 * and the modules it declares.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

interface ModuleJson {
  id: string;
  version: string;
  api: string;
  provides: string;
  imports: Record<string, string>;
  plugins: string[];
}

/** The modules: each directory of `modules/` with a `module.json`. */
function modules(root: string): string[] {
  return fs
    .readdirSync(path.join(root, 'modules'))
    .filter((d) => fs.existsSync(path.join(root, 'modules', d, 'module.json')))
    .map((d) => `modules/${d}`);
}

const read = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

/** The `.ts` files under `dir`, relative to it. */
function sources(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .flatMap((e) =>
      e.isFile() && e.name.endsWith('.ts')
        ? [path.relative(dir, path.join(e.parentPath, e.name))]
        : []
    );
}

/** The specifiers a file imports from, static and dynamic. */
function specifiers(text: string): string[] {
  return [...text.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/gu)].map((m) => m[1] as string);
}

describe('the modules', () => {
  const all = modules(ROOT);

  it('are the three of RegnoTron', () => {
    expect(all.map((m) => path.basename(m)).sort()).toEqual([
      'game-bots',
      'norelec',
      'norelec-tools',
    ]);
  });

  for (const dir of all) {
    const id = path.basename(dir);
    const json = read<ModuleJson>(path.join(ROOT, dir, 'module.json'));
    const pkg = read<Record<string, unknown>>(path.join(ROOT, dir, 'package.json'));

    describe(id, () => {
      it('declares itself as the package it is', () => {
        expect(json).toMatchObject({ id, api: '1', provides: `@regnotron/${id}` });
        expect(json.version).toMatch(/^\d+\.\d+\.\d+$/u);
        expect(pkg).toMatchObject({
          name: json.provides,
          version: json.version,
          license: 'MIT',
          exports: { './*': './src/*' },
        });
        // No npm dependencies of its own: the shell's and zod are the host's copies.
        for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies'])
          expect(pkg[key]).toBeUndefined();
      });

      it('names plugin entry points that exist, each exporting a plugin factory', () => {
        expect(json.plugins.length).toBeGreaterThan(0);
        for (const entry of json.plugins) {
          expect(entry).toMatch(/^src\/plugins\/[\w-]+\.ts$/u);
          const text = fs.readFileSync(path.join(ROOT, dir, entry), 'utf8');
          expect(text).toMatch(/export function \w+Plugin\(/u);
        }
      });

      it('imports only Node, the shell, zod, its own files and the modules it declares', () => {
        const declared = new Set(Object.keys(json.imports));
        for (const name of declared) expect(all).toContain(`modules/${name.split('/')[1]}`);
        const found = new Set<string>();
        for (const dirName of ['src', 'test']) {
          const base = path.join(ROOT, dir, dirName);
          if (!fs.existsSync(base)) continue;
          for (const file of sources(base)) {
            const test = dirName === 'test' || file.endsWith('.test.ts');
            for (const s of specifiers(fs.readFileSync(path.join(base, file), 'utf8'))) {
              const ok =
                s.startsWith('node:') ||
                s.startsWith('@megabottron1999/') ||
                s === 'zod' ||
                s.startsWith('#src/') ||
                s.startsWith('./') ||
                (test && (s === 'vitest' || s.startsWith('#test/'))) ||
                s.startsWith('@regnotron/');
              expect(ok, `${dir}/${dirName}/${file}: ${s}`).toBe(true);
              const m = /^(@regnotron\/[\w-]+)/u.exec(s);
              if (m !== null && !test) found.add(m[1] as string);
            }
          }
        }
        expect([...found].sort()).toEqual([...declared].sort());
      });
    });
  }
});
