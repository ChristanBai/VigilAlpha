#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { runInvestCandidateResearch } from '../src/vigilalpha/invest-candidate.mjs';

try {
  const [file, ...extra] = process.argv.slice(2);
  if (!file || extra.length) throw new Error('Usage: node scripts/invest-research.mjs dataset.json');
  const dataset = JSON.parse(await readFile(file, 'utf8'));
  const report = runInvestCandidateResearch(dataset, dataset);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'COMPUTED') process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
