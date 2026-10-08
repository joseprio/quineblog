// The document is the database: posts live as prerendered <article>s inside <main>.
// This module reads and writes them, regenerates the derived markup (tables of contents,
// category list, metadata) and converts between the page and portable JSON data.
import { $, $$, esc, fmtDate, link, mk, root, slugify, today } from './dom';
import { type Lang, languages, setLanguages } from './code';

export interface Post { slug: string; title: string; date: string; categories: string[]; html: string }
export interface Site { title: string; description: string; author?: string; hue: number; lang: string }
export interface BlogData { format: 'quine-blog'; version: number; generator?: string; site: Site; posts: Post[]; languages?: Lang[] }

export const DATA_VERSION = 1;
/** Route names that can't be used as post slugs. */
export const RESERVED = ['categories', 'category'];

export const main = $('main');
export const posts = () => $$('main>article');
export const findPost = (slug: string) => {
  const a = slug ? document.getElementById(slug) : null;
  return a?.parentElement === main && !RESERVED.includes(slug) ? a : null;
};

export type Meta = Omit<Post, 'html'>;
export const meta = (a: HTMLElement): Meta => ({
  slug: a.id,
  title: $('h2', a).textContent!.trim(),
  date: $('time', a).getAttribute('datetime') ?? '',
  categories: $$('header a[rel=tag]', a).map(x => x.textContent!.trim()),
});
export const readPost = (a: HTMLElement): Post => ({ ...meta(a), html: $('section', a).innerHTML.trim() });
export const inCategory = (a: HTMLElement, cat: string) => meta(a).categories.some(c => slugify(c) === cat);

export function site(): Site {
  return {
    title: $('body>header h1 a').textContent!.trim(),
    description: $('body>header>p').textContent!.trim(),
    author: $<HTMLMetaElement>('meta[name=author]')?.content ?? '',
    hue: Number(root.style.getPropertyValue('--hue')) || 250,
    lang: root.lang || 'en',
  };
}

export function setSite(s: Partial<Site>) {
  if (typeof s.title === 'string' && s.title.trim()) $('body>header h1 a').textContent = s.title.trim();
  if (typeof s.description === 'string') $('body>header>p').textContent = s.description.trim();
  if (typeof s.author === 'string') {
    // The tag only exists when there is an author.
    const name = s.author.trim(), tag = $<HTMLMetaElement>('meta[name=author]');
    if (!name) tag?.remove();
    else if (tag) tag.content = name;
    else $('meta[name=description]').after(Object.assign(document.createElement('meta'), { name: 'author', content: name }));
  }
  if (Number.isFinite(s.hue)) root.style.setProperty('--hue', String(Math.round(s.hue!) % 360));
  if (typeof s.lang === 'string' && /^[a-z]{2,3}(-[\w]+)*$/i.test(s.lang)) root.lang = s.lang;
}

/* ---------- sanitising ---------- */

// Tag -> allowed attributes. Everything else is unwrapped (children kept) or dropped.
const ALLOW: Record<string, string[]> = {
  P: [], H3: [], H4: [], B: [], STRONG: [], I: [], EM: [], U: [], S: [], SUB: [], SUP: [], CODE: ['data-lang'], PRE: ['data-lang'],
  BLOCKQUOTE: [], UL: [], OL: [], LI: [], BR: [], HR: ['data-more'], A: ['href', 'title'],
  IMG: ['src', 'alt', 'width', 'height'], TABLE: [], THEAD: [], TBODY: [], TR: [],
  TH: ['colspan', 'rowspan'], TD: ['colspan', 'rowspan'], FIGURE: [], FIGCAPTION: [],
};
// Post titles are <h2>, so body headings start at <h3>.
const RENAME: Record<string, string> = { H1: 'H3', H2: 'H3', H5: 'H4', H6: 'H4', STRIKE: 'S', DEL: 'S' };
const DROP = /^(SCRIPT|STYLE|META|LINK|TITLE|TEMPLATE|IFRAME|OBJECT|EMBED|NOSCRIPT|SVG|MATH)$/;

export function clean(node: ParentNode) {
  for (let n of [...node.childNodes]) {
    if (n.nodeType === Node.TEXT_NODE) continue;
    if (!(n instanceof Element) || DROP.test(n.nodeName.toUpperCase())) { n.remove(); continue }
    clean(n);
    let tag = RENAME[n.nodeName] ?? n.nodeName;
    if (tag === 'DIV') tag = n.querySelector('p,h3,h4,ul,ol,pre,blockquote,table,figure,hr') ? '' : 'P';
    if (!(tag in ALLOW)) { n.replaceWith(...n.childNodes); continue }
    if (tag !== n.nodeName) {
      const r = document.createElement(tag);
      r.append(...n.childNodes);
      n.replaceWith(r);
      n = r;
    }
    const el = n as Element;
    if (tag === 'PRE' || tag === 'CODE') {
      // Keep the language from pasted markup such as <code class="language-js">.
      const lang = el.getAttribute('data-lang') || /\blang(?:uage)?-([\w+#-]+)/.exec(el.getAttribute('class') ?? '')?.[1];
      if (lang) el.setAttribute('data-lang', lang.toLowerCase());
    }
    for (const { name, value } of [...el.attributes]) {
      const bad = !ALLOW[tag].includes(name)
        || /^\s*(javascript|vbscript|data:text)/i.test(value)
        || (name === 'src' && !/^(data:image\/|https?:)/i.test(value));
      if (bad) el.removeAttribute(name);
    }
    if (tag === 'P' && !el.textContent!.trim() && !el.querySelector('img')) el.remove();
    if (tag === 'PRE') normalizePre(el);
  }
}

/** A code block is always <pre><code data-lang?>plain text</code></pre>; formatting inside it is dropped. */
function normalizePre(pre: Element) {
  const lang = pre.getAttribute('data-lang') || pre.querySelector('code[data-lang]')?.getAttribute('data-lang');
  pre.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  const code = document.createElement('code');
  code.textContent = pre.textContent!.replace(/ /g, ' ');
  if (lang && /^[\w+#-]{1,40}$/.test(lang)) code.setAttribute('data-lang', lang);
  pre.replaceChildren(code);
  pre.removeAttribute('data-lang');
}

/** Keeps a single "read more" marker and moves it to the top level so CSS can hide what follows it. */
export function liftMore(c: HTMLElement) {
  const [hr, ...rest] = $$('hr[data-more]', c);
  rest.forEach(h => h.remove());
  if (!hr) return;
  let top: Node = hr;
  while (top.parentNode !== c) top = top.parentNode!;
  if (top !== hr) (top as Element).after(hr);
}

/** Parses untrusted HTML inertly (a <template> runs no scripts and loads nothing), then sanitises it. */
export function sanitize(html: string): string {
  const t = document.createElement('template');
  t.innerHTML = html;
  clean(t.content);
  const box = document.createElement('div');
  box.append(t.content);
  liftMore(box);
  return box.innerHTML.trim()
    .replace(/(<\/(p|h3|h4|ul|ol|pre|blockquote|table|figure)>|<hr[^>]*>)(?!\n)/g, '$1\n');
}

/* ---------- writing posts ---------- */

export function uniqueSlug(wanted: string, self: Element | null = null) {
  let base = slugify(wanted) || 'post';
  if (RESERVED.includes(base)) base += '-post';
  let slug = base;
  for (let i = 2, o; (o = document.getElementById(slug)) && o !== self; i++) slug = `${base}-${i}`;
  return slug;
}

/** Creates or updates a post's <article>. The HTML body is sanitised on the way in. */
export function writePost(p: Post, a: HTMLElement | null = null): HTMLElement {
  const el = a ?? document.createElement('article');
  const slug = uniqueSlug(p.slug || p.title, el);
  const cats = [...new Map(p.categories.map(c => c.trim()).filter(slugify).map(c => [slugify(c), c])).values()];
  const date = /^\d{4}-\d\d-\d\d$/.test(p.date) ? p.date : today();
  el.id = slug;
  el.innerHTML = `
<header>
<h2><a href="${link(slug)}">${esc(p.title.trim())}</a></h2>
<p><time datetime="${date}">${fmtDate(date)}</time>${cats.map(c => `\n<a rel="tag" href="${link('category', slugify(c))}">${esc(c)}</a>`).join('')}</p>
</header>
<section>
${sanitize(p.html)}
</section>
<footer><a href="${link(slug)}">Read more</a></footer>
`;
  if (!a) $('#categories').after(el);
  return el;
}

/* ---------- derived markup ---------- */

function buildToc(a: HTMLElement) {
  const used = new Set<string>();
  let out = '', open = false;
  for (const h of $$('section :is(h3,h4)', a)) {
    const base = slugify(h.textContent!) || 'section';
    let k = base;
    for (let i = 2; used.has(k); i++) k = `${base}-${i}`;
    used.add(k);
    h.id = `${a.id}--${k}`; // runtime only, stripped by exportHTML()
    const li = `<li><a href="${link(a.id, k)}">${esc(h.textContent!.trim())}</a>`;
    if (h.tagName === 'H4') {
      if (!open) { out = out.endsWith('</li>') ? out.slice(0, -5) + '<ol>' : out + '<li><ol>'; open = true }
      out += li + '</li>';
    } else {
      if (open) { out += '</ol></li>'; open = false }
      out += li + '</li>';
    }
  }
  if (open) out += '</ol></li>';
  // Runtime only (data-rt), like the heading ids: rebuilt at startup instead of stored in the page.
  $$(':scope>nav[data-rt]', a).forEach(n => n.remove());
  if (out) $(':scope>header', a).after(mk('nav', {}, `<p><strong>Contents</strong></p><ol>${out}</ol>`, { 'aria-label': 'Contents' }));
}

function snippet(a: HTMLElement) {
  let t = '';
  for (const n of $('section', a).children) {
    if (n.matches('hr[data-more]')) break;
    t += n.textContent + ' ';
  }
  return t.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Sorts posts newest first and regenerates everything derived from them. Idempotent. */
export function rebuild() {
  const s = site(), cats = new Map<string, [string, number]>();
  const list = posts().sort((x, y) => meta(y).date.localeCompare(meta(x).date));
  [...main.childNodes].forEach(n => n.nodeType === Node.TEXT_NODE && !n.textContent!.trim() && n.remove());
  main.prepend('\n');
  for (const a of list) {
    main.append('\n', a);
    buildToc(a);
    for (const c of meta(a).categories) {
      const k = slugify(c), e = cats.get(k);
      cats.set(k, [e?.[0] ?? c, (e?.[1] ?? 0) + 1]);
    }
  }
  main.append('\n');

  $('#categories').innerHTML = '\n<h2>Categories</h2>\n<ul>' + [...cats]
    .sort((x, y) => x[1][0].localeCompare(y[1][0]))
    .map(([k, [name, n]]) => `\n<li><a href="${link('category', k)}">${esc(name)}</a> <small>(${n})</small></li>`)
    .join('') + '\n</ul>\n';

  $<HTMLMetaElement>('meta[name=description]').content = s.description;
  $<HTMLMetaElement>('meta[property="og:description"]').content = s.description;
  $<HTMLMetaElement>('meta[property="og:title"]').content = s.title;
  $<HTMLLinkElement>('link[rel=icon]').href = 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="hsl(${s.hue} 65% 50%)"/><path d="M9 11h14M9 16h14M9 21h9" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>`);
  // "© <year> <author>" only when there is an author; exportHTML() stamps the year.
  const copyright = $('body>footer time')?.parentElement;
  if (!s.author) copyright?.remove();
  else if (copyright) $('span', copyright).textContent = s.author;
  else $('body>footer').prepend('\n', Object.assign(document.createElement('p'), { innerHTML: `© <time>${new Date().getFullYear()}</time> <span>${esc(s.author)}</span>` }));
  const author = s.author ? { author: { '@type': 'Person', name: s.author } } : {};
  $('#ld').textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Blog', name: s.title, description: s.description, inLanguage: s.lang, ...author,
    blogPost: list.map(a => {
      const m = meta(a);
      return { '@type': 'BlogPosting', headline: m.title, datePublished: m.date, ...author, keywords: m.categories.join(', '), description: snippet(a), url: link(m.slug) };
    }),
  }).replace(/</g, '\\u003c');
}

/* ---------- import / export ---------- */

const generator = () => $<HTMLMetaElement>('meta[name=generator]').content;

export function exportData(): BlogData {
  return { format: 'quine-blog', version: DATA_VERSION, generator: generator(), site: site(), posts: posts().map(readPost), languages: languages() };
}

/** Replaces the site settings and every post with the given data. Throws on data it can't read. */
export function importData(input: unknown) {
  const d = input as Partial<BlogData> | null;
  if (!d || d.format !== 'quine-blog' || !Array.isArray(d.posts)) throw new Error('This file is not a Quine Blog data export.');
  if (typeof d.version !== 'number' || d.version > DATA_VERSION) throw new Error(`This data was exported by a newer version (${d.generator ?? 'unknown'}). Update this page first.`);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  setSite({ author: '', ...d.site }); // data without an author clears it
  if (Array.isArray(d.languages)) {
    setLanguages(d.languages.filter(l => l && /^[\w-]+$/.test(l.id) && typeof l.source === 'string').map(l => ({
      id: l.id, source: l.source,
      requires: Array.isArray(l.requires) ? l.requires.map(String) : [],
      after: Array.isArray(l.after) ? l.after.map(String) : [],
    })));
  }
  posts().forEach(a => a.remove());
  for (const p of d.posts as Partial<Post>[]) {
    if (!p || !str(p.title).trim()) continue;
    writePost({
      slug: str(p.slug), title: str(p.title), date: str(p.date), html: str(p.html),
      categories: Array.isArray(p.categories) ? p.categories.map(str) : [],
    });
  }
  rebuild();
}

/** Serialises the page as a clean, prerendered HTML file: the quine step. */
export function exportHTML(): string {
  const c = root.cloneNode(true) as HTMLElement, body = $('body', c);
  $$('[data-rt]', c).forEach(e => e.remove());
  ['data-theme', 'data-view'].forEach(a => c.removeAttribute(a));
  $$('main [hidden]', c).forEach(e => e.removeAttribute('hidden'));
  $$('[aria-current]', c).forEach(e => e.removeAttribute('aria-current'));
  $$('main>article>section [id]', c).forEach(e => e.removeAttribute('id')); // heading ids: rebuild() derives them at startup
  $('title', c).textContent = site().title;
  const year = $('body>footer time', c);
  if (year) year.textContent = String(new Date().getFullYear()); // © year of generation
  while (body.lastChild?.nodeType === Node.TEXT_NODE && !body.lastChild.textContent!.trim()) body.lastChild.remove();
  body.append('\n');
  return '<!doctype html>\n' + c.outerHTML + '\n';
}
