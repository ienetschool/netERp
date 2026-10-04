import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The API client unwraps exactly one `data` level and drops `meta`, so a
 * paginated list arrives as `{ rows, total }`. Reading `query.data?.data` or
 * `query.data?.meta.total` therefore renders an empty table or throws on a real
 * response — defects that typecheck cleanly, because the generic parameter
 * describes the shape the page wished for rather than the shape the API sends.
 *
 * These two cases are one contract: the row array and its total travel
 * together, so a page that takes one through `data` must take the other too.
 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\.data\?\.(?:data|items)\b/, why: 'unwraps a second data level' },
  { pattern: /\.data\??\.meta\b/, why: 'the client drops meta; totals live beside rows' },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const APP_DIR = path.resolve(process.cwd(), 'src/app');
const FILES = sourceFiles(APP_DIR);

describe('list envelope contract', () => {
  it('finds the app pages it is meant to police', () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it('reads rows and totals from one level, never from meta', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!/Query\.data|\.data\?\./.test(line)) return;
          for (const { pattern, why } of FORBIDDEN) {
            if (pattern.test(line)) {
              offenders.push(`${path.relative(APP_DIR, file)}:${i + 1} ${why} — ${line.trim()}`);
            }
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});