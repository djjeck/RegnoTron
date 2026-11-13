/**
 * The modules keep MegaBotTron1999's module format (its docs/bot-os.md D49): each directory of
 * `modules/` has a `module.json` that names it, the import name it provides and the modules it
 * imports, and its plugin entry points; it is also a workspace package of the same name and
 * version, with no npm dependencies; and its code imports only Node, the shell, zod, its own files
 * and the modules it declares.
 */
import { parseManifest, type Plugin } from '@megabottron1999/core';
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

/**
 * The library modules of other repositories the modules import, vendored as submodules and run as
 * workspaces (README, "Development"): each by the name it provides, with its version. None now:
 * @InventoryBot's grammar left with its parser for InventoryBotTron.
 */
const VENDORED: Record<string, string> = Object.fromEntries(
  ([] as string[]).map((dir) => {
    const json = read<ModuleJson>(path.join(ROOT, dir, 'module.json'));
    return [json.provides, json.version];
  })
);

/** Whether `version` satisfies a caret range (`^1.2.3`, `^0.2.0`), the form the modules use. */
function satisfiesCaret(version: string, range: string): boolean {
  const [v, r] = [version, range.replace(/^\^/u, '')].map((x) => x.split('.').map(Number)) as [
    number[],
    number[],
  ];
  const major = r[0] === 0 ? 2 : 1; // ^0.x.y fixes the minor too
  for (let i = 0; i < major; i++) if (v[i] !== r[i]) return false;
  for (let i = 0; i < 3; i++)
    if ((v[i] as number) !== (r[i] as number)) return (v[i] as number) > (r[i] as number);
  return true;
}

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

  it('satisfy caret ranges as npm does', () => {
    expect(['0.2.0', '0.2.5', '0.3.0', '0.1.9'].map((v) => satisfiesCaret(v, '^0.2.0'))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(['1.2.3', '1.9.0', '2.0.0', '1.2.2'].map((v) => satisfiesCaret(v, '^1.2.3'))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

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

      it('names plugin entry points that exist, each exporting its plugins, built from config', async () => {
        expect(json.plugins.length).toBeGreaterThan(0);
        for (const entry of json.plugins) {
          expect(entry).toMatch(/^src\/plugins\/[\w-]+\.ts$/u);
          // The loader's contract (MegaBotTron1999's docs/bot-os-api.md §7.2): `plugins`, an array
          // of plugins whose manifests are valid; no factory takes a deployment's values.
          const exported = (await import(path.join(ROOT, dir, entry))) as { plugins?: unknown };
          expect(Array.isArray(exported.plugins), `${dir}/${entry}`).toBe(true);
          const plugins = exported.plugins as Plugin[];
          expect(plugins.length).toBeGreaterThan(0);
          for (const p of plugins) expect(() => parseManifest(p.manifest)).not.toThrow();
        }
      });

      it('imports only Node, the shell, zod, its own files and the modules it declares', () => {
        const declared = new Set(Object.keys(json.imports));
        for (const [name, range] of Object.entries(json.imports)) {
          expect(range).toMatch(/^\^\d+\.\d+\.\d+$/u);
          if (name.startsWith('@regnotron/'))
            expect(all).toContain(`modules/${name.split('/')[1]}`);
          else {
            expect(VENDORED[name], name).toBeDefined();
            expect(satisfiesCaret(VENDORED[name] as string, range), `${name} ${range}`).toBe(true);
          }
        }
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
                s.startsWith('@regnotron/') ||
                s in VENDORED;
              expect(ok, `${dir}/${dirName}/${file}: ${s}`).toBe(true);
              const m = /^(@regnotron\/[\w-]+)/u.exec(s);
              if (m !== null && !test) found.add(m[1] as string);
              if (s in VENDORED && !test) found.add(s);
            }
          }
        }
        expect([...found].sort()).toEqual([...declared].sort());
      });
    });
  }
});
