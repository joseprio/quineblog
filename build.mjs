// Builds the final product: one self-contained, prerendered HTML file.
//
//   npm run build                                  -> dist/index.html with content/seed.json
//   npm run build -- --data my-blog.json --out public/index.html
//   npm run build -- --langs markup,css,clike,javascript,python   (Prism grammars stored in the page)
//
// Steps: bundle and minify src/main.ts (+ Prism core) and src/styles.css with esbuild, inline both into src/index.html together with the Prism
// grammars (copied as-is, never minified by this build), then load that page in jsdom, import the content with the page's own importData() and
// save it with its own exportHTML(), exactly as the in-browser "Download HTML" button does.
import { build, transform } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    data: { type: 'string', default: 'content/seed.json' },
    out: { type: 'string', default: 'dist/index.html' },
    langs: { type: 'string', default: 'markup,css,clike,javascript' },
  },
});

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const generator = `quine-blog ${pkg.version}`;
const prismVersion = JSON.parse(await readFile('node_modules/prismjs/package.json', 'utf8')).version;

const js = (await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
  define: { PRISM_VERSION: JSON.stringify(prismVersion) },
  banner: { js: `/*! ${generator} | based on pell 1.0.6 (MIT) github.com/jaredreich/pell | Prism ${prismVersion} (MIT) prismjs.com */` },
})).outputFiles[0].text.trim();
const css = (await transform(await readFile('src/styles.css', 'utf8'), { loader: 'css', minify: true })).code.trim();

for (const [what, code, tag] of [['script', js, '</script'], ['stylesheet', css, '</style']]) {
  if (code.toLowerCase().includes(tag)) throw new Error(`The ${what} contains "${tag}", which would end the inline tag early.`);
}

// Prism grammars, with prerequisites first; stored as inert scripts the page evaluates itself.
const components = JSON.parse(await readFile('node_modules/prismjs/components.json', 'utf8')).languages;
const list = v => (v ? [v].flat() : []);
const resolve = name => (name in components && name !== 'meta' ? name : Object.keys(components).find(k => list(components[k].alias).includes(name)));
const langIds = [];
const addLang = id => {
  if (langIds.includes(id)) return;
  list(components[id].require).forEach(addLang);
  langIds.push(id);
};
for (const name of args.langs.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
  const id = resolve(name);
  if (!id) throw new Error(`Prism has no language called "${name}".`);
  addLang(id);
}
// Same escaping as escapeSource() in src/code.ts.
const escapeSource = src => src.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '\\x3C!--');
const langScripts = (await Promise.all(langIds.map(async id => {
  const c = components[id], src = (await readFile(`node_modules/prismjs/components/prism-${id}.min.js`, 'utf8')).trim();
  const requires = list(c.require), after = [...list(c.optional), ...list(c.modify)];
  return `<script type="text/plain" data-prism-lang="${id}"${requires.length ? ` data-requires="${requires.join(' ')}"` : ''}${after.length ? ` data-after="${after.join(' ')}"` : ''}>${escapeSource(src)}</script>\n`;
}))).join('');

const template = await readFile('src/index.html', 'utf8');
const shell = template.split('{{GENERATOR}}').join(generator).split('{{STYLE}}').join(css).split('{{SCRIPT}}').join(js).split('{{LANGS}}').join(langScripts);

/** Loads HTML in jsdom with scripts running; jsdom's "not implemented" noise is ignored. */
function load(html) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    if (!/Not implemented|Could not parse CSS/.test(e.message)) throw e;
  });
  vc.on('error', (...a) => console.error('[page]', ...a));
  return new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc }).window;
}

const data = JSON.parse(await readFile(args.data, 'utf8'));
const page = load(shell);
page.quine.importData(data);
const output = page.quine.exportHTML();
page.close();

// A quine must reproduce itself: loading the output and saving it again has to change nothing.
const again = load(output);
const roundTrip = again.quine.exportHTML();
again.close();
if (roundTrip !== output) throw new Error('Round-trip check failed: re-exporting the built page changed it.');

await mkdir(dirname(args.out), { recursive: true });
await writeFile(args.out, output);
const kib = n => `${(n / 1024).toFixed(1)} KiB`;
console.log(`${args.out}: ${data.posts.length} posts, languages: ${langIds.join(', ')}, ${kib(output.length)} (${generator})`);
console.log(`  script ${kib(js.length)}, styles ${kib(css.length)}, grammars ${kib(langScripts.length)} (not minified)`);
