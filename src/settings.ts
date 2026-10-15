// Blog settings dialog: title, description, theme hue, code languages, JSON import/export of all content and restoring snapshots.
import { $, esc, fields, mk, pickFiles, root, saveFile, slugify } from './dom';
import { exportData, importData, posts, rebuild, setSite, site } from './content';
import { go, route } from './views';
import { setDirty } from './state';
import { addFromCDN, addFromFile, dependents, highlight, languages, removeLanguages } from './code';
import { clearSnapshots, newSession, restore, snapshots } from './snapshots';

let dialog: HTMLDialogElement | undefined;
let savedHue = 250;
let showLangs = () => {};

function build() {
  const d = mk('dialog', {}, `<form>
<h2>Blog settings</h2>
<label>Blog title<input name="title" required></label>
<label>Description<input name="desc"></label>
<label>Author<input name="author" placeholder="Optional; shown in the footer and search results"></label>
<label>Favicon URL<span class="favicon"><input name="favicon" placeholder="Optional; e.g. https://example.com/icon.png or favicon.ico"><img alt="" hidden></span></label>
<label>Theme hue: <output></output><input name="hue" type="range" min="0" max="359"></label>
<h3>Code languages</h3>
<ul></ul>
<p><button type="button" name="cdn" class="secondary">Download from jsDelivr…</button> <button type="button" name="langfile" class="secondary">Add from file…</button></p>
<footer><span><button type="button" name="export" class="secondary">Export data</button> <button type="button" name="import" class="secondary">Import data</button> <details><summary>Restore</summary><menu></menu></details> <button type="button" name="del" class="secondary">Delete all posts</button></span><button type="button" name="cancel" class="secondary">Cancel</button><button>Apply</button></footer>
</form>`);
  document.body.append(d);
  const form = $<HTMLFormElement>('form', d), F = fields(form), out = $<HTMLOutputElement>('output', form);
  const revert = () => root.style.setProperty('--hue', String(savedHue));

  const list = $('ul', form);
  const renderLangs = () => {
    list.innerHTML = languages().map(l => `<li>${esc(l.id)} <small>${(l.source.length / 1024).toFixed(1)} KB${l.requires.length ? ', needs ' + esc(l.requires.join(', ')) : ''}</small>
<button type="button" data-remove="${esc(l.id)}" title="Remove ${esc(l.id)}" aria-label="Remove ${esc(l.id)}">×</button></li>`).join('') || '<li><small>None installed</small></li>';
  };
  const langsChanged = () => { renderLangs(); highlight(); setDirty(true) };
  list.onclick = e => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-remove]')?.dataset.remove;
    if (!id) return;
    const deps = dependents(id);
    if (deps.length && !confirm(`${deps.join(', ')} ${deps.length > 1 ? 'need' : 'needs'} ${id} and will be removed too. Continue?`)) return;
    removeLanguages([id, ...deps]);
    langsChanged();
  };
  F.cdn.onclick = async () => {
    const name = prompt('Language to download (e.g. python, typescript, bash):')?.trim();
    if (!name) return;
    F.cdn.disabled = true;
    try {
      const added = await addFromCDN(name);
      if (!added.length) alert(`${name} is already installed.`);
      langsChanged();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      F.cdn.disabled = false;
    }
  };
  F.langfile.onclick = async () => {
    const [file] = await pickFiles('.js,text/javascript');
    if (!file) return;
    const id = /prism-([\w-]+?)(?:\.min)?\.js$/i.exec(file.name)?.[1] ?? prompt('Language id (as used in code blocks):')?.trim();
    if (!id) return;
    if (!confirm(`Adding a language runs the code in ${file.name} inside this page. Only use files you trust. Continue?`)) return;
    try { addFromFile(id.toLowerCase(), await file.text()) } catch (err) { alert((err as Error).message) }
    langsChanged();
  };
  showLangs = renderLangs;

  // Favicon preview: hidden while the field is empty or the image doesn't load.
  const icon = $<HTMLImageElement>('.favicon img', form);
  icon.onload = () => { icon.hidden = false };
  icon.onerror = () => { icon.hidden = true };
  F.favicon.oninput = () => {
    const url = F.favicon.value.trim();
    icon.hidden = true;
    if (url) icon.src = url; else icon.removeAttribute('src');
  };

  F.hue.oninput = () => { root.style.setProperty('--hue', F.hue.value); out.value = F.hue.value };
  F.cancel.onclick = () => { revert(); d.close() };
  d.addEventListener('cancel', revert);
  form.onsubmit = e => {
    e.preventDefault();
    setSite({ title: F.title.value, description: F.desc.value, author: F.author.value, favicon: F.favicon.value, hue: Number(F.hue.value) });
    rebuild();
    setDirty(true);
    d.close();
    route();
  };
  F.export.onclick = () => {
    const s = site();
    saveFile(`${slugify(s.title) || 'blog'}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportData(), null, 2), 'application/json');
  };
  F.import.onclick = async () => {
    const [file] = await pickFiles('application/json,.json');
    if (!file || !confirm('Importing replaces all posts and settings on this page. Continue?')) return;
    try {
      importData(JSON.parse(await file.text()));
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
      return;
    }
    newSession(); // keeps the snapshot from before the import
    setDirty(true);
    d.close();
    go('#/');
  };

  // Restore: a dropdown of this page's automatic snapshots, newest first.
  const restoreMenu = $<HTMLDetailsElement>('details', form), snaps = $('menu', restoreMenu);
  const when = (date: Date) => date.toLocaleString(root.lang || 'en', { dateStyle: 'medium', timeStyle: 'medium' });
  restoreMenu.ontoggle = () => {
    if (!restoreMenu.open) return;
    const list = snapshots();
    snaps.innerHTML = (list.map(s => `<li><button type="button" data-key="${esc(s.key)}">${esc(when(s.date))} <small>${s.posts} post${s.posts === 1 ? '' : 's'}${s.current ? ', this session' : ''}</small></button></li>`).join('')
      || '<li><button type="button" disabled>No snapshots yet</button></li>')
      + `<li><button type="button" name="clear"${list.length ? '' : ' disabled'}>Clear all snapshots</button></li>`;
  };
  snaps.onclick = e => {
    const b = (e.target as Element).closest('button');
    if (!b || b.disabled) return;
    restoreMenu.open = false;
    if (b.name === 'clear') {
      if (confirm('Delete all saved snapshots of this blog?')) clearSnapshots();
      return;
    }
    const s = snapshots().find(x => x.key === b.dataset.key);
    if (!s || !confirm(`Restore the snapshot from ${when(s.date)}? It replaces all posts and settings on this page.`)) return;
    try {
      restore(s.key);
    } catch (err) {
      alert(`Restore failed: ${(err as Error).message}`);
      return;
    }
    d.close();
    go('#/');
  };
  // Close like a menu: on outside clicks, and on Escape without also closing the dialog.
  d.addEventListener('click', e => { if (!restoreMenu.contains(e.target as Node)) restoreMenu.open = false });
  restoreMenu.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !restoreMenu.open) return;
    e.preventDefault();
    e.stopPropagation();
    restoreMenu.open = false;
    $('summary', restoreMenu).focus();
  });

  F.del.onclick = () => {
    const n = posts().length;
    if (!n || !confirm(`Delete all ${n} post${n === 1 ? '' : 's'}? Settings and code languages are kept.`)) return;
    posts().forEach(p => p.remove());
    revert();
    newSession(); // keeps the snapshot from before the deletion
    rebuild();
    setDirty(true);
    d.close();
    go('#/');
  };
  return d;
}

export function openSettings() {
  dialog ??= build();
  const F = fields($<HTMLFormElement>('form', dialog)), s = site();
  savedHue = s.hue;
  F.title.value = s.title;
  F.desc.value = s.description;
  F.author.value = s.author ?? '';
  F.favicon.value = s.favicon ?? '';
  F.favicon.dispatchEvent(new Event('input'));
  F.hue.value = String(s.hue);
  $<HTMLOutputElement>('output', dialog).value = String(s.hue);
  showLangs();
  dialog.showModal();
}
