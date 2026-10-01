import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DASH = '—';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules' && name !== '__snapshots__') sourceFiles(full, out);
    } else if (/\.(ts|js|mjs)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function dashedLiterals(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const kind = file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && node.text.includes(DASH)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${path.relative(ROOT, file)}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('aucun tiret cadratin affiché (spec 2026-10-01 fiches § 7)', () => {
  it('aucun littéral de chaîne de src/ ni d’api/ n’en contient', () => {
    const offenders = [...sourceFiles(path.join(ROOT, 'src')), ...sourceFiles(path.join(ROOT, 'api'))].flatMap(dashedLiterals);
    expect(offenders).toEqual([]);
  });
});

function dataFiles(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') dataFiles(full, ext, out);
    } else if (ext.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function dashedJsonValues(value: unknown, trail: string, file: string, out: string[]): void {
  if (typeof value === 'string') {
    if (value.includes(DASH)) out.push(`${file}: ${trail}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => dashedJsonValues(v, `${trail}[${i}]`, file, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) dashedJsonValues(v, trail ? `${trail}.${k}` : k, file, out);
  }
}

describe('aucun tiret cadratin dans les données JSON ni les pages HTML', () => {
  it('aucune valeur de chaîne des .json / .geojson de src/ et public/ n’en contient', () => {
    const offenders: string[] = [];
    for (const dir of ['src', 'public']) {
      for (const file of dataFiles(path.join(ROOT, dir), /\.(json|geojson)$/)) {
        dashedJsonValues(JSON.parse(readFileSync(file, 'utf8')), '', path.relative(ROOT, file), offenders);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('index.html et les .html de public/ n’en contiennent pas', () => {
    const files = [path.join(ROOT, 'index.html'), ...dataFiles(path.join(ROOT, 'public'), /\.html$/)];
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes(DASH)).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
