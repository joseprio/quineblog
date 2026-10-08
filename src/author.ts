// Author menu: a "⋯" dropdown next to Categories for writing posts, settings and saving the page,
// plus a bar at the bottom that only appears while there are unsaved changes.
import { $, $$, mk, root, saveFile } from './dom';
import { exportHTML } from './content';
import { currentPost, routeHooks, view } from './views';
import { isDirty, onDirty, setDirty } from './state';
import { openEditor } from './editor';
import { openSettings } from './settings';

const menu = mk('details', {}, `<summary aria-label="Blog actions" title="Blog actions">⋯</summary>
<menu>
<li><button type="button" name="new">New post</button></li>
<li><button type="button" name="edit">Edit this post</button></li>
<li><button type="button" name="settings">Settings</button></li>
<li><button type="button" name="save">Download HTML</button></li>
<li aria-label="Colour theme"><button type="button" name="theme" value="auto" title="Follow the system">◐ Auto</button><button type="button" name="theme" value="light">☀ Light</button><button type="button" name="theme" value="dark">☾ Dark</button></li>
</menu>`);

const bar = mk('aside', { hidden: true }, `<p>You have unsaved changes. Download the page and upload it to publish them.</p>
<button type="button">Download HTML</button>`, { 'aria-label': 'Unsaved changes' });

type Theme = 'auto' | 'light' | 'dark';

/** Light, dark or the system's choice; remembered per browser (the early script in <head> applies it before paint). */
function setTheme(t: Theme) {
  if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  try { if (t === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', t) } catch { /* storage blocked */ }
  for (const b of $$<HTMLButtonElement>('[name=theme]', menu)) b.setAttribute('aria-pressed', String(b.value === t));
}

function download() {
  const name = decodeURIComponent(location.pathname.split('/').pop() ?? '');
  saveFile(/\.html?$/i.test(name) ? name : 'index.html', exportHTML(), 'text/html');
  setDirty(false);
}

function update() {
  $('[name=edit]', menu).parentElement!.hidden = view() !== 'post';
  bar.hidden = !isDirty();
}

export function startAuthor() {
  const actions: Record<string, () => void> = {
    new: () => openEditor(),
    edit: () => openEditor(currentPost()),
    settings: openSettings,
    save: download,
  };
  menu.onclick = e => {
    const button = (e.target as Element).closest('button');
    if (!button) return;
    const name = button.name;
    if (name === 'theme') return setTheme(button.value as Theme); // stays open to show the change
    menu.open = false;
    actions[name]?.();
  };
  // Close like a menu: on outside clicks and Escape.
  document.addEventListener('click', e => { if (menu.open && !menu.contains(e.target as Node)) menu.open = false });
  menu.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.open) { menu.open = false; $('summary', menu).focus() } });

  $('button', bar).onclick = download;
  document.body.append(bar);
  const li = mk('li');
  li.append(menu);
  $('body>header ul:last-child>li').after(li);
  routeHooks.push(update);
  onDirty(update);
  addEventListener('beforeunload', e => { if (isDirty()) e.preventDefault() });
  setTheme((root.dataset.theme as Theme) ?? 'auto');
  update();
}
