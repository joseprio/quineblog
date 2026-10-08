// Post editor: a <dialog> around Pell, with inlined images and a "read more" marker.
import { exec, init, type Editor as Pell } from './pell';
import { $, $$, esc, fields, link, mk, pickFiles, slugify, today } from './dom';
import { meta, readPost, rebuild, sanitize, writePost } from './content';
import { go } from './views';
import { setDirty } from './state';
import { languageNames } from './code';

interface Editor {
  dialog: HTMLDialogElement; form: HTMLFormElement; F: Record<string, HTMLInputElement>;
  content: HTMLElement; pell: Pell | null; current: HTMLElement | null; autoSlug: boolean; saved: Range | null;
}
let ed: Editor | undefined;

const MAX_WIDTH = 1600;
const readURL = (b: Blob) => new Promise<string>((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(r.result as string);
  r.onerror = ko;
  r.readAsDataURL(b);
});

/** Turns an image into a data URL, downscaling and re-encoding it when that makes it smaller. */
export async function toDataURL(b: Blob): Promise<string> {
  const raw = await readURL(b);
  if (/svg|gif/.test(b.type) || b.size < 5e4) return raw;
  try {
    const bm = await createImageBitmap(b), k = Math.min(1, MAX_WIDTH / bm.width), c = document.createElement('canvas');
    c.width = Math.round(bm.width * k);
    c.height = Math.round(bm.height * k);
    c.getContext('2d')!.drawImage(bm, 0, 0, c.width, c.height);
    const out = [raw, c.toDataURL('image/webp', 0.82)];
    if (/jpe?g/.test(b.type)) out.push(c.toDataURL('image/jpeg', 0.82));
    return out.sort((x, y) => x.length - y.length)[0];
  } catch {
    return raw;
  }
}

/** Puts the caret back where it was in the editor (dialogs and file pickers steal focus). */
function restoreSelection(e: Editor) {
  const s = getSelection()!;
  e.content.focus();
  s.removeAllRanges();
  if (e.saved && e.content.contains(e.saved.startContainer)) s.addRange(e.saved);
  else {
    const r = document.createRange();
    r.selectNodeContents(e.content);
    r.collapse(false);
    s.addRange(r);
  }
}

async function insertImages(e: Editor, files: File[]) {
  for (const f of files.filter(f => f.type.startsWith('image/'))) {
    const src = await toDataURL(f), img = new Image();
    img.src = src;
    await img.decode().catch(() => {});
    const alt = prompt('Describe this image (alt text):', f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')) ?? '';
    const size = img.naturalWidth ? ` width="${img.naturalWidth}" height="${img.naturalHeight}"` : '';
    restoreSelection(e);
    exec('insertHTML', `<img src="${src}" alt="${esc(alt)}"${size}>`);
  }
}

/** Turns the current block into a code block, or changes the language of the one the caret is in. */
function codeBlock(e: Editor) {
  restoreSelection(e);
  const inPre = () => {
    const n = getSelection()?.anchorNode;
    const pre = (n instanceof Element ? n : n?.parentElement)?.closest('pre');
    return pre && e.content.contains(pre) ? pre : null;
  };
  let pre = inPre();
  const current = pre?.querySelector('code')?.dataset.lang ?? pre?.dataset.lang ?? '';
  const lang = prompt(`Code language, or empty for none.\nInstalled: ${languageNames().join(', ') || 'none'}`, current);
  if (lang === null) return;
  restoreSelection(e);
  if (!pre) { exec('formatBlock', '<pre>'); pre = inPre() }
  if (!pre) return;
  const target = pre.querySelector('code') ?? pre, id = lang.trim().toLowerCase();
  if (id) target.dataset.lang = id; else delete target.dataset.lang;
}

/** Toggles inline code: unwraps the <code> around the caret, or wraps the selection (or a placeholder to type over) in one. */
function inlineCode(e: Editor) {
  restoreSelection(e);
  const s = getSelection()!, n = s.anchorNode, el = n instanceof Element ? n : n?.parentElement;
  if (el?.closest('pre')) return; // already code
  const select = (node: Node) => { const r = document.createRange(); r.selectNodeContents(node); s.removeAllRanges(); s.addRange(r) };
  const code = el?.closest(':not(pre) > code');
  if (code && e.content.contains(code)) {
    const text = document.createTextNode(code.textContent!);
    code.replaceWith(text);
    select(text);
    return;
  }
  // Inserted as nodes: execCommand('insertHTML') would turn the surrounding spaces into &nbsp;.
  const r = s.getRangeAt(0), block = el?.closest('p,li,h3,h4,blockquote');
  if (block && !block.contains(r.endContainer)) r.setEndAfter(block.lastChild!); // keep to one paragraph
  const added = document.createElement('code');
  added.textContent = r.toString() || 'code';
  r.deleteContents();
  r.insertNode(added);
  select(added);
}

/** Puts the single "read more" marker after the top-level block holding the caret. */
function insertMore(e: Editor) {
  restoreSelection(e);
  $$('hr[data-more]', e.content).forEach(h => h.remove());
  const s = getSelection()!;
  let block: Node | null = s.rangeCount ? s.getRangeAt(0).startContainer : null;
  while (block && block.parentNode !== e.content) block = block.parentNode;
  const hr = document.createElement('hr');
  hr.dataset.more = '';
  e.content.insertBefore(hr, block ? block.nextSibling : null);
  // Keep somewhere to type below the marker; empty paragraphs are dropped on save.
  let next = hr.nextSibling;
  if (!(next instanceof Element)) {
    next = Object.assign(document.createElement('p'), { innerHTML: '<br>' });
    hr.after(next);
  }
  const r = document.createRange();
  r.setStart(next, 0);
  r.collapse(true);
  s.removeAllRanges();
  s.addRange(r);
}

function editor(): Editor {
  if (ed) return ed;
  const dialog = mk('dialog', {}, `<form>
<h2></h2>
<fieldset>
<label>Title<input name="title" required></label>
<label>Slug<input name="slug" required></label>
<label>Date<input name="date" type="date" required></label>
<label>Categories<input name="cats" placeholder="Comma, separated"></label>
</fieldset>
<div></div>
<footer><button type="button" name="del" class="secondary">Delete</button><button type="button" name="cancel" class="secondary">Cancel</button><button>Apply</button></footer>
</form>`);
  document.body.append(dialog);
  const form = $<HTMLFormElement>('form', dialog), F = fields(form), host = $('div', form);
  const e: Editor = { dialog, form, F, content: host, pell: null, current: null, autoSlug: false, saved: null };
  e.pell = init({
    element: host,
    defaultParagraphSeparator: 'p',
    actions: [
      'undo', 'redo',
      'bold', 'italic', 'strikethrough',
      { icon: '<b>H</b>', title: 'Heading', active: 'h3', result: () => exec('formatBlock', '<h3>') },
      { icon: '<b>h</b>', title: 'Subheading', active: 'h4', result: () => exec('formatBlock', '<h4>') },
      'paragraph', 'quote', 'olist', 'ulist',
      { icon: '<code>`c`</code>', title: 'Inline code', active: ':not(pre) > code', result: () => inlineCode(e) },
      { icon: '&lt;/&gt;', title: 'Code block (choose a language)', active: 'pre', result: () => codeBlock(e) },
      'link',
      { icon: '&#128247;', title: 'Insert image', result: () => { pickFiles('image/*', true).then(f => insertImages(e, f)) } },
      'line',
      { icon: '&#9986;', title: 'Read more break (where the snippet ends)', result: () => insertMore(e) },
    ],
  });
  e.content = e.pell.content;

  document.addEventListener('selectionchange', () => {
    const s = getSelection();
    if (s?.rangeCount && e.content.contains(s.anchorNode)) e.saved = s.getRangeAt(0).cloneRange();
  });
  e.content.addEventListener('paste', ev => {
    const cd = ev.clipboardData!, files = [...cd.files], html = cd.getData('text/html');
    ev.preventDefault();
    if (files.some(f => f.type.startsWith('image/'))) return void insertImages(e, files);
    if (!html) return void exec('insertText', cd.getData('text/plain'));
    exec('insertHTML', sanitize(html));
    // Try to inline pasted remote images; ones the server won't share (CORS) stay as links.
    for (const img of $$<HTMLImageElement>('img:not([src^="data:"])', e.content)) {
      fetch(img.src).then(r => r.blob()).then(toDataURL).then(u => (img.src = u)).catch(() => {});
    }
  });
  e.content.addEventListener('drop', ev => {
    const files = [...ev.dataTransfer?.files ?? []];
    if (!files.length) return;
    ev.preventDefault();
    const r = (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null })
      .caretRangeFromPoint?.(ev.clientX, ev.clientY);
    if (r) e.saved = r;
    insertImages(e, files);
  });

  F.title.oninput = () => { if (e.autoSlug) F.slug.value = slugify(F.title.value) };
  F.slug.oninput = () => (e.autoSlug = false);
  F.cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', ev => { if (!confirm('Discard your changes to this post?')) ev.preventDefault() });
  F.del.onclick = () => {
    if (!e.current || !confirm(`Delete “${F.title.value}”?`)) return;
    e.current.remove();
    rebuild();
    setDirty(true);
    dialog.close();
    go('#/');
  };
  form.onsubmit = ev => {
    ev.preventDefault();
    const a = writePost({
      slug: F.slug.value, title: F.title.value, date: F.date.value,
      categories: F.cats.value.split(','), html: e.content.innerHTML,
    }, e.current);
    rebuild();
    setDirty(true);
    dialog.close();
    go(link(a.id));
  };
  return (ed = e);
}

export function openEditor(a?: HTMLElement) {
  const e = editor(), F = e.F;
  const p = a ? readPost(a) : { slug: '', title: '', date: today(), categories: [], html: '<p><br></p>' };
  e.current = a ?? null;
  e.autoSlug = !a;
  e.saved = null;
  $('h2', e.form).textContent = a ? `Edit “${meta(a).title}”` : 'New post';
  F.title.value = p.title;
  F.slug.value = p.slug;
  F.date.value = p.date;
  F.cats.value = p.categories.join(', ');
  e.content.innerHTML = p.html;
  e.pell!.resetHistory();
  F.del.hidden = !a;
  e.dialog.showModal();
}
