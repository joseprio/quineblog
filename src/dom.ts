// Small DOM helpers shared by every module.

export const root = document.documentElement;

export const $ = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) =>
  scope.querySelector(sel) as T;

export const $$ = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<T>(sel)];

export const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

export const slugify = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

/** Hash route such as `#/my-post/a-heading`. */
export const link = (...parts: string[]) => '#/' + parts.map(encodeURIComponent).join('/');

export const today = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

export const fmtDate = (iso: string) =>
  new Date(iso + 'T12:00').toLocaleDateString(root.lang || 'en', { year: 'numeric', month: 'long', day: 'numeric' });

/** Creates a runtime-only element. Anything marked `data-rt` is stripped when the page saves itself. */
export function mk<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, html = '', attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.setAttribute('data-rt', '');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (html) el.innerHTML = html;
  return el;
}

/** Form controls by name, typed loosely enough for inputs and buttons alike. */
export const fields = (form: HTMLFormElement) =>
  form.elements as unknown as Record<string, HTMLInputElement>;

export function saveFile(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
