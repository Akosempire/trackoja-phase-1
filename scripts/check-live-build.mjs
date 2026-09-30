import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Run after deploying: node scripts/check-live-build.mjs [https://trackoja.cv]
const origin = new URL(process.argv[2] ?? 'https://trackoja.cv');
const dist = new URL('../dist/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const entry = html => html.match(/src="(\/assets\/index-[^" ]+\.js)"/)?.[1];
async function fetchFresh(path) {
  const url = new URL(path, origin);
  url.searchParams.set('buildcheck', Date.now().toString());
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}
try {
  const expected = entry(await readFile(new URL('index.html', dist), 'utf8'));
  if (!expected) throw new Error('No production entry found. Build the application first.');
  let matches = true;
  for (const path of ['/', '/dashboard', '/platform']) {
    const response = await fetchFresh(path);
    const actual = entry(await response.text());
    const same = actual === expected;
    matches &&= same;
    console.log(`${same ? 'PASS' : 'STALE'} ${path}: ${actual ?? 'no application entry'}; expected ${expected}`);
    console.log(`  Cache-Control: ${response.headers.get('cache-control') ?? '(not supplied)'}`);
  }
  const worker = await fetchFresh('/sw.js');
  const workerMatches = hash(Buffer.from(await worker.arrayBuffer())) === hash(await readFile(new URL('sw.js', dist)));
  matches &&= workerMatches;
  console.log(`${workerMatches ? 'PASS' : 'STALE'} service worker matches local production build`);
  if (matches) {
    const response = await fetchFresh(expected);
    const assetMatches = hash(Buffer.from(await response.arrayBuffer())) === hash(await readFile(new URL(expected.slice(1), dist)));
    matches &&= assetMatches;
    console.log(`${assetMatches ? 'PASS' : 'MISMATCH'} application entry bytes`);
  }
  if (!matches) console.log('The site is not serving this build. Deploy the committed dist directory before asking users to refresh.');
  process.exitCode = matches ? 0 : 1;
} catch (error) {
  console.error(`Deployment check failed: ${error.message}`);
  process.exitCode = 1;
}
