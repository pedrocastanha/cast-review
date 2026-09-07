import { readFile, writeFile } from 'node:fs/promises';

const origin = new URL(process.env.PUBLIC_API_ORIGIN ?? '');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('PUBLIC_API_ORIGIN must be an HTTPS origin');
}
const path = new URL('../vercel.json', import.meta.url);
const config = JSON.parse(await readFile(path, 'utf8'));
config.rewrites = [
  { source: '/api/:path*', destination: `${origin.origin}/:path*` },
  { source: '/:path*', destination: '/index.html' },
];
await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
