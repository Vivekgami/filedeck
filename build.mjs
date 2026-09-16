/**
 * Build: src/ -> dist/
 *
 *   node build.mjs
 *
 * Four outputs:
 *   filedeck.umd.js      browser global, for a plain <script> tag and the CDNs
 *   filedeck.umd.min.js  the same, minified — what unpkg and jsDelivr serve
 *   filedeck.esm.js      named export, for bundlers and `import`
 *   filedeck.css         copied, plus a minified twin
 *
 * The source assigns window.Filedeck, so the UMD build is close to a copy; the
 * ESM build wraps it so `import Filedeck from 'filedeck'` works without the
 * consumer depending on a global being set.
 */

import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('./package.json', 'utf8'));

const banner = `/*! ${pkg.name} v${pkg.version} | ${pkg.license} | ${pkg.homepage} */`;

await rm('./dist', { recursive: true, force: true });
await mkdir('./dist', { recursive: true });

const source = await readFile('./src/filedeck.js', 'utf8');

/* -- UMD: the source as-is, since it already assigns the global ------------ */

await writeFile('./dist/filedeck.umd.js', `${banner}\n${source}`);

await build({
  stdin: { contents: source, loader: 'js' },
  outfile: './dist/filedeck.umd.min.js',
  minify: true,
  target: ['es2019'],
  banner: { js: banner },
  legalComments: 'none'
});

/* -- ESM: same code, exported ----------------------------------------------
   `globalThis.window ??= globalThis` keeps the module importable in a Node
   context (SSR, a test runner) without throwing at import time. It still needs
   a real DOM to construct, but importing it must never crash a server render.
   -------------------------------------------------------------------- */

const esmSource = `${banner}
globalThis.window ??= globalThis;
${source}
const Filedeck = globalThis.window.Filedeck;
export default Filedeck;
export { Filedeck };
`;

await writeFile('./dist/filedeck.esm.js', esmSource);

await build({
  stdin: { contents: esmSource, loader: 'js', resolveDir: '.' },
  outfile: './dist/filedeck.esm.min.js',
  minify: true,
  format: 'esm',
  target: ['es2019'],
  banner: { js: banner },
  legalComments: 'none'
});

/* -- CSS ------------------------------------------------------------------- */

const css = await readFile('./src/filedeck.css', 'utf8');
await writeFile('./dist/filedeck.css', `${banner}\n${css}`);

await build({
  stdin: { contents: css, loader: 'css', resolveDir: './src' },
  outfile: './dist/filedeck.min.css',
  minify: true,
  banner: { css: banner },
  legalComments: 'none'
});

/* -- report ---------------------------------------------------------------- */

const { stat } = await import('node:fs/promises');
const files = [
  'filedeck.umd.js', 'filedeck.umd.min.js',
  'filedeck.esm.js', 'filedeck.esm.min.js',
  'filedeck.css', 'filedeck.min.css'
];

console.log(`\n${pkg.name} v${pkg.version}\n`);
for (const file of files) {
  const { size } = await stat(`./dist/${file}`);
  console.log(`  dist/${file.padEnd(22)} ${(size / 1024).toFixed(1)} kB`);
}
console.log('');
