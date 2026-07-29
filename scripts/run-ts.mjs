#!/usr/bin/env node
/** Run a local TypeScript QA fixture with the same @/ alias as Next.js. */
import path from 'path';
import { fileURLToPath } from 'url';
import { createJiti } from 'jiti';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/run-ts.mjs <file>');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, {
  alias: { '@': root },
});

await jiti.import(path.resolve(target));
