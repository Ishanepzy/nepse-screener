// Downloads fresh prices and writes the site's data file (public/data/snapshot.json).
//   npm run data                 refresh from merolagani, then write the file
//   npm run data -- --discover   also re-scan every listed symbol for new / revived listings
//   npm run data -- --offline    skip the download and rebuild the file from the local cache
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Store } from './store.ts';
import { encodeSnapshot } from '../shared/snapshot.ts';

const OUT_FILE = path.resolve(import.meta.dirname, '..', 'public', 'data', 'snapshot.json');
const args = process.argv.slice(2);

const store = new Store();
await store.load();
if (!args.includes('--offline')) {
  await store.refresh({ discover: args.includes('--discover'), log: console.log });
}
if (store.bars.size === 0) throw new Error('No price data. Run without --offline first.');

const json = JSON.stringify(encodeSnapshot(store.dataset()));
await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, json);
const mb = (n: number) => (n / 1e6).toFixed(2);
console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}: ${store.bars.size} symbols, ${mb(json.length)} MB (${mb(gzipSync(json).length)} MB gzipped)`);
