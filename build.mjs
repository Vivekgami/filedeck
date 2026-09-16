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

import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* Paths resolve from this file, not the working directory, so the build works
   the same whether it's run through npm or invoked from somewhere else. */
const root = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(root, 'src', ...p);
const dist = (...p) => join(root, 'dist', ...p);

for (const file of ['filedeck.js', 'filedeck.css']) {
  try {
    await stat(src(file));
  } catch {
    console.error(
      `\nMissing src/${file}\n\n` +
      `Expected layout:\n` +
      `  package.json\n  build.mjs\n  src/filedeck.js\n  src/filedeck.css\n\n` +
      `If the source files are sitting next to package.json, move them into a\n` +
      `src/ folder and run the build again.\n`
    );
    process.exit(1);
  }
}

/* Imported after the checks above, so a missing src/ reports itself rather
   than being masked by a module-resolution error. */
let build;
try {
  ({ build } = await import('esbuild'));
} catch {
  console.error('\nesbuild is not installed. Run:\n\n  npm install\n');
  process.exit(1);
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const banner = `/*! ${pkg.name} v${pkg.version} | ${pkg.license} | ${pkg.homepage} */`;

await rm(dist(), { recursive: true, force: true });
await mkdir(dist(), { recursive: true });

const source = await readFile(src('filedeck.js'), 'utf8');

/* -- UMD: the source as-is, since it already assigns the global ------------ */

await writeFile(dist('filedeck.umd.js'), `${banner}\n${source}`);

await build({
  stdin: { contents: source, loader: 'js' },
  outfile: dist('filedeck.umd.min.js'),
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

await writeFile(dist('filedeck.esm.js'), esmSource);

await build({
  stdin: { contents: esmSource, loader: 'js', resolveDir: root },
  outfile: dist('filedeck.esm.min.js'),
  minify: true,
  format: 'esm',
  target: ['es2019'],
  banner: { js: banner },
  legalComments: 'none'
});

/* -- CSS ------------------------------------------------------------------- */

const css = await readFile(src('filedeck.css'), 'utf8');
await writeFile(dist('filedeck.css'), `${banner}\n${css}`);

await build({
  stdin: { contents: css, loader: 'css', resolveDir: src() },
  outfile: dist('filedeck.min.css'),
  minify: true,
  banner: { css: banner },
  legalComments: 'none'
});

/* -- report ---------------------------------------------------------------- */

const files = [
  'filedeck.umd.js', 'filedeck.umd.min.js',
  'filedeck.esm.js', 'filedeck.esm.min.js',
  'filedeck.css', 'filedeck.min.css'
];

console.log(`\n${pkg.name} v${pkg.version}\n`);
for (const file of files) {
  const { size } = await stat(dist(file));
  console.log(`  dist/${file.padEnd(22)} ${(size / 1024).toFixed(1)} kB`);
}
console.log('');
