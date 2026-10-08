// Hash router. Views never render content; they only toggle what is already in the page:
//   #/                 home, snippets with infinite scroll
//   #/category/<slug>  the same list, filtered
//   #/categories       the prerendered category list
//   #/<post>[/<heading>] one full post with its table of contents
import { $, $$, esc, link, mk, root, slugify } from './dom';
import { findPost, inCategory, main, meta, posts, site } from './content';

const PAGE = 5;
export type View = 'list' | 'post' | 'categories';
export const view = () => root.dataset.view as View | undefined;
export const currentPost = () => (view() === 'post' ? posts().find(p => !p.hidden) : undefined);
export const routeHooks: Array<() => void> = [];

let shown = PAGE, listKey: string | null = null, curList: string | null = null;
const scrollPos = new Map<string, number>();
let transient: Element[] = [];

// Infinite scroll: a sentinel after <main> reveals another page when it nears the viewport.
const sentinel = mk('p', { hidden: true }, '', { 'aria-hidden': 'true' });
main.after(sentinel);
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver(e => {
    if (e[0].isIntersecting && view() === 'list' && !sentinel.hidden) { shown += PAGE; paginate() }
  }, { rootMargin: '0px 0px 800px' })
  : null;

export const go = (hash: string) => (location.hash === hash ? route() : (location.hash = hash));

export function route() {
  if (curList !== null) scrollPos.set(curList, scrollY);
  transient.forEach(e => e.remove());
  transient = [];
  sentinel.hidden = true;
  curList = null;
  const [a = '', b = ''] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const post = findPost(a);
  if (post) showPost(post, b);
  else if (a === 'categories') {
    root.dataset.view = 'categories';
    posts().forEach(p => (p.hidden = true));
    document.title = `Categories · ${site().title}`;
    scrollTo(0, 0);
  } else showList(a === 'category' ? b : '');
  routeHooks.forEach(fn => fn());
}

function showList(cat: string) {
  root.dataset.view = 'list';
  if (cat !== listKey) { shown = io ? PAGE : Infinity; listKey = cat }
  curList = cat;
  let title = site().title;
  if (cat) {
    const name = posts().flatMap(p => meta(p).categories).find(c => slugify(c) === cat) ?? cat;
    const h = mk('h2', {}, `Posts in “${esc(name)}” <small><a href="#/">all posts</a></small>`);
    $('#categories').after(h);
    transient.push(h);
    title = `${name} · ${title}`;
  }
  document.title = title;
  paginate();
  scrollTo(0, scrollPos.get(cat) ?? 0);
}

function paginate() {
  let n = 0;
  for (const p of posts()) p.hidden = !((!listKey || inCategory(p, listKey)) && n++ < shown);
  sentinel.hidden = n <= shown;
  // Re-observing fires a fresh callback, so a sentinel still in view keeps loading.
  if (io) { io.unobserve(sentinel); io.observe(sentinel) }
}

function showPost(p: HTMLElement, heading: string) {
  root.dataset.view = 'post';
  posts().forEach(x => (x.hidden = x !== p));
  const list = posts(), i = list.indexOf(p), newer = list[i - 1], older = list[i + 1];
  const nav = mk('nav', {},
    (older ? `<a href="${link(older.id)}" rel="prev">← ${esc(meta(older).title)}</a>` : '<span></span>') +
    (newer ? `<a href="${link(newer.id)}" rel="next">${esc(meta(newer).title)} →</a>` : ''),
    { 'aria-label': 'More posts' });
  main.after(nav);
  transient.push(nav);
  document.title = `${meta(p).title} · ${site().title}`;
  const target = heading && document.getElementById(`${p.id}--${heading}`);
  if (target) target.scrollIntoView(); else scrollTo(0, 0);
  spy();
}

/** Highlights the table-of-contents entry for the section being read. */
export function spy() {
  const p = currentPost();
  if (!p) return;
  // The last heading above the reading line; at the very bottom, the last one on screen.
  const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
  const line = atEnd ? innerHeight : 120;
  let cur: HTMLElement | undefined;
  for (const h of $$('section :is(h3,h4)', p)) {
    if (h.getBoundingClientRect().top < line) cur = h; else break;
  }
  const want = cur && link(p.id, cur.id.slice(p.id.length + 2));
  for (const a of $$(':scope>nav a', p)) {
    if (a.getAttribute('href') === want) a.setAttribute('aria-current', 'location');
    else a.removeAttribute('aria-current');
  }
}

export function startRouter() {
  history.scrollRestoration = 'manual';
  addEventListener('hashchange', route);
  addEventListener('scroll', () => requestAnimationFrame(spy), { passive: true });
  // Clicking a link to the current route (e.g. a TOC entry already in the URL) should still scroll.
  document.addEventListener('click', e => {
    const a = (e.target as Element).closest?.('a[href^="#/"]');
    if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); route() }
  });
  route();
}
