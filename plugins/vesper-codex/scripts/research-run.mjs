#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { runResearchValidation } from '../src/vigilalpha/research-run.mjs';

try {
  const [file, ...extra] = process.argv.slice(2);
  if (!file || extra.length) throw new Error('Usage: node scripts/research-run.mjs dataset.json (with initialCash and costBps)');
  const dataset = JSON.parse(await readFile(file, 'utf8'));
  const result = runResearchValidation(dataset, dataset);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'COMPUTED') process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
