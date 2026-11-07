import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const LINK = '<link rel="stylesheet" href="coach.css" />';
const out = 'package/ui';
mkdirSync(out, { recursive: true });

await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'none', outfile: `${out}/coach.js` });
const css = await build({ entryPoints: ['src/coach.css'], bundle: true, minify: true, write: false, outfile: 'coach.css' });
const page = readFileSync('src/index.html', 'utf8');
if (!page.includes(LINK)) throw new Error(`src/index.html must hold ${LINK}`);
writeFileSync(`${out}/index.html`, page.replace(LINK, `<style>${css.outputFiles[0].text.trim()}</style>`));
console.log(`built ${out}/index.html and ${out}/coach.js`);
