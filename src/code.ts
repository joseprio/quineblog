// Syntax highlighting. Prism tokenises <pre><code data-lang> blocks and the CSS Custom Highlight API
// paints the tokens, so the stored HTML never contains highlighting markup.
//
// Grammars live in the page as inert <script type="text/plain" data-prism-lang="id"> elements, so
// they're saved with it and can be added or removed at runtime.
import './prism-setup';
import 'prismjs/components/prism-core';
import { $$ } from './dom';

type PrismAPI = typeof import('prismjs');
type Stream = Array<string | import('prismjs').Token>;
const Prism = (window as unknown as { Prism: PrismAPI }).Prism;

declare const PRISM_VERSION: string; // injected by the build
const CDN = `https://cdn.jsdelivr.net/npm/prismjs@${PRISM_VERSION}`;

export interface Lang { id: string; requires: string[]; after: string[]; source: string }

/** What Prism.languages holds before any grammar is loaded (plain text plus helpers). */
const BASE = { ...Prism.languages };
const mainScript = document.currentScript;
const words = (s?: string | null) => (s ?? '').split(/\s+/).filter(Boolean);
const list = (v: unknown): string[] => (v ? [v].flat().map(String) : []);
const scripts = () => $$<HTMLScriptElement>('script[data-prism-lang]');

export const languages = (): Lang[] => scripts().map(s => ({
  id: s.dataset.prismLang!, requires: words(s.dataset.requires), after: words(s.dataset.after), source: s.text,
}));

/** Installed languages with the aliases that point at the same grammar, e.g. "javascript (js)". */
export const languageNames = () => languages().map(({ id }) => {
  const aliases = Object.keys(Prism.languages).filter(k => k !== id && !(k in BASE) && Prism.languages[k] === Prism.languages[id]);
  return aliases.length ? `${id} (${aliases.join(', ')})` : id;
});

// Grammars sometimes contain "</script" or "<!--", which would break the inline <script> they're stored in.
// Keep in sync with escapeSource() in build.mjs.
const escapeSource = (src: string) => src.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '\\x3C!--');

/** Dependencies (and the grammars a language extends) load first. */
function ordered(langs: Lang[]) {
  const byId = new Map(langs.map(l => [l.id, l])), done = new Set<string>(), out: Lang[] = [];
  const visit = (l: Lang, path: Set<string>) => {
    if (done.has(l.id) || path.has(l.id)) return;
    path.add(l.id);
    for (const d of [...l.requires, ...l.after]) { const dep = byId.get(d); if (dep) visit(dep, path) }
    done.add(l.id);
    out.push(l);
  };
  langs.forEach(l => visit(l, new Set()));
  return out;
}

/** Resets Prism and evaluates every stored grammar. */
export function loadGrammars() {
  for (const k of Object.keys(Prism.languages)) if (!(k in BASE)) delete Prism.languages[k];
  Object.assign(Prism.languages, BASE);
  for (const l of ordered(languages())) {
    try { new Function('Prism', l.source)(Prism) } catch (err) { console.warn(`Prism language "${l.id}" failed to load`, err) }
  }
}

function store(l: Lang) {
  scripts().find(s => s.dataset.prismLang === l.id)?.remove();
  const s = document.createElement('script');
  s.type = 'text/plain';
  s.dataset.prismLang = l.id;
  if (l.requires.length) s.dataset.requires = l.requires.join(' ');
  if (l.after.length) s.dataset.after = l.after.join(' ');
  s.text = escapeSource(l.source);
  if (mainScript?.parentNode) mainScript.before(s, '\n'); else document.body.append(s, '\n');
}

/** Replaces every stored grammar (used by data import). */
export function setLanguages(langs: Lang[]) {
  scripts().forEach(s => s.remove());
  langs.forEach(store);
  loadGrammars();
}

/** Removes a language; returns the installed languages that need it. */
export const dependents = (id: string) => languages().filter(l => l.requires.includes(id)).map(l => l.id);
export function removeLanguages(ids: string[]) {
  scripts().filter(s => ids.includes(s.dataset.prismLang!)).forEach(s => s.remove());
  loadGrammars();
}

async function fetchText(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Couldn't download ${url} (${r.status}).`);
  return r.text();
}

/** Installs a language (and its prerequisites) from jsDelivr. Returns the ids that were added. */
export async function addFromCDN(name: string): Promise<string[]> {
  const all: Record<string, { alias?: string | string[]; require?: string | string[]; optional?: string | string[]; modify?: string | string[] }> =
    JSON.parse(await fetchText(`${CDN}/components.json`)).languages;
  const wanted = name.trim().toLowerCase();
  const id = wanted in all && wanted !== 'meta' ? wanted : Object.keys(all).find(k => list(all[k].alias).includes(wanted));
  if (!id) throw new Error(`Prism has no language called “${name}”.`);
  const have = new Set(languages().map(l => l.id)), added: string[] = [];
  const install = async (lid: string) => {
    if (have.has(lid)) return;
    have.add(lid);
    const c = all[lid];
    for (const r of list(c.require)) await install(r);
    store({ id: lid, requires: list(c.require), after: [...list(c.optional), ...list(c.modify)], source: await fetchText(`${CDN}/components/prism-${lid}.min.js`) });
    added.push(lid);
  };
  await install(id);
  loadGrammars();
  return added;
}

/** Installs a grammar file from disk, e.g. prism-python.min.js. */
export function addFromFile(id: string, source: string) {
  store({ id, requires: [], after: [], source });
  loadGrammars();
  if (!Prism.languages[id]) throw new Error(`The file loaded, but it didn't define a language called “${id}”.`);
}

/* ---------- painting ---------- */

const GROUPS: Record<string, string> = {
  comment: 'comment', prolog: 'comment', doctype: 'comment', cdata: 'comment',
  keyword: 'keyword', atrule: 'keyword', important: 'keyword', rule: 'keyword',
  string: 'string', char: 'string', 'attr-value': 'string', regex: 'string', url: 'string', inserted: 'string', 'template-string': 'string',
  number: 'number', boolean: 'number', constant: 'number', symbol: 'number',
  function: 'function', 'class-name': 'function', builtin: 'function',
  tag: 'tag', selector: 'tag', deleted: 'tag', namespace: 'tag',
  'attr-name': 'attr', property: 'attr', variable: 'attr', entity: 'attr',
  punctuation: 'punct', operator: 'operator',
};
const supported = typeof CSS !== 'undefined' && 'highlights' in CSS;

function textNodes(el: Node) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out: Text[] = [];
  while (w.nextNode()) out.push(w.currentNode as Text);
  return out;
}

/** Highlights the code blocks of the visible posts. */
export function highlight() {
  if (!supported) return;
  const groups = new Map<string, Range[]>();
  for (const code of $$('main>article:not([hidden]) pre>code[data-lang]')) {
    const grammar = Prism.languages[code.dataset.lang!];
    if (!grammar) continue;
    const nodes = textNodes(code);
    let pos = 0;
    const point = (offset: number): [Text, number] => {
      for (const n of nodes) { if (offset <= n.length) return [n, offset]; offset -= n.length }
      const last = nodes[nodes.length - 1];
      return [last, last.length];
    };
    const add = (len: number, group?: string) => {
      if (group && len) {
        const r = new Range();
        r.setStart(...point(pos));
        r.setEnd(...point(pos + len));
        groups.get(group)?.push(r) ?? groups.set(group, [r]);
      }
      pos += len;
    };
    const walk = (stream: Stream, inherited?: string) => {
      for (const t of stream) {
        if (typeof t === 'string') { add(t.length, inherited); continue }
        const group = GROUPS[t.type] ?? list(t.alias).map(a => GROUPS[a]).find(Boolean) ?? inherited;
        if (typeof t.content === 'string') add(t.content.length, group);
        else walk([t.content].flat() as Stream, group);
      }
    };
    walk(Prism.tokenize(nodes.map(n => n.data).join(''), grammar));
  }
  for (const g of new Set(Object.values(GROUPS))) {
    const ranges = groups.get(g);
    if (ranges) CSS.highlights.set(`tok-${g}`, new Highlight(...ranges)); else CSS.highlights.delete(`tok-${g}`);
  }
}
