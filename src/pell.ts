// Rich-text editor: a TypeScript copy of pell 1.0.6 (github.com/jaredreich/pell, MIT, © Jared Reich), adapted for this blog:
// - a button's highlighted state comes from the markup around the cursor (`active` selector) instead of document.queryCommandState,
//   which reports headings as bold and knows nothing about headings, lists or code blocks;
// - states refresh on every selection change, including arrow keys;
// - toolbar clicks don't take focus (and the selection) away from the text;
// - its own undo/redo history (the browser's misses changes made by direct DOM edits);
// - only the default actions the blog uses are kept.

export interface Action {
  name?: string;
  icon: string;
  title: string;
  /** Selector for the element that makes this button "on" when the cursor is inside it. */
  active?: string;
  result: (editor: Editor) => unknown;
}

/** What init() returns, also passed to action results. */
export interface Editor { content: HTMLElement; undo(): void; redo(): void; resetHistory(): void }
/** A default action by name, with some of its fields replaced. */
export type Override = Partial<Action> & { name: keyof typeof defaults };

export interface Options {
  element: HTMLElement;
  actions: Array<keyof typeof defaults | Action | Override>;
  defaultParagraphSeparator?: string;
  onChange?: (html: string) => void;
}

const formatBlock = 'formatBlock';
/** 16px line icon in the text colour. */
const svg = (body: string, box = '0 0 16 16') => `<svg viewBox="${box}" width="16" height="16" fill="currentColor" aria-hidden="true">${body}</svg>`;
const lines = '<rect x="6" y="2.75" width="9" height="1.5" rx=".75"/><rect x="6" y="7.25" width="9" height="1.5" rx=".75"/><rect x="6" y="11.75" width="9" height="1.5" rx=".75"/>';
export const exec = (command: string, value: string | null = null) => document.execCommand(command, false, value ?? undefined);

const defaults = {
  undo: { icon: svg('<path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>', '1 1 22 22'), title: 'Undo (Ctrl+Z)', result: (ed: Editor) => ed.undo() },
  redo: { icon: svg('<path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>', '1 1 22 22'), title: 'Redo (Ctrl+Y)', result: (ed: Editor) => ed.redo() },
  bold: { icon: '<b>B</b>', title: 'Bold', active: 'b,strong', result: () => exec('bold') },
  italic: { icon: '<i>I</i>', title: 'Italic', active: 'i,em', result: () => exec('italic') },
  strikethrough: { icon: '<s>S</s>', title: 'Strike-through', active: 's,strike,del', result: () => exec('strikeThrough') },
  paragraph: { icon: '&#182;', title: 'Paragraph', result: () => exec(formatBlock, '<p>') },
  quote: { icon: svg('<path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>', '4 4 16 16'), title: 'Quote', active: 'blockquote', result: () => exec(formatBlock, '<blockquote>') },
  olist: { icon: svg(lines + '<text x="3.5" font-size="5" font-family="system-ui,sans-serif" font-weight="700" text-anchor="middle"><tspan y="5.2">1</tspan><tspan x="3.5" y="9.7">2</tspan><tspan x="3.5" y="14.2">3</tspan></text>'), title: 'Numbered list', active: 'ol', result: () => exec('insertOrderedList') },
  ulist: { icon: svg(lines + '<circle cx="2.5" cy="3.5" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="2.5" cy="12.5" r="1.4"/>'), title: 'Bulleted list', active: 'ul', result: () => exec('insertUnorderedList') },
  line: { icon: '&#8213;', title: 'Horizontal Line', result: () => exec('insertHorizontalRule') },
  link: {
    icon: '&#128279;', title: 'Link', active: 'a[href]',
    result: () => { const url = prompt('Enter the link URL'); if (url) exec('createLink', url) },
  },
} satisfies Record<string, Action>;

/** Builds the toolbar and the editable area inside `element`; returns the editable area. */
/** A snapshot of the editable area: its HTML and where the selection was, as child-index paths. */
interface State { html: string; sel: [number[], number, number[], number] | null }
const GROUP_MS = 1000; // typing closer together than this is one undo step

export function init({ element, actions, defaultParagraphSeparator = 'div', onChange }: Options): Editor {
  const list: Action[] = actions.map(a => typeof a === 'string' ? { name: a, ...defaults[a] } : 'name' in a && a.name! in defaults ? { ...defaults[a.name as keyof typeof defaults], ...a } : a as Action);

  const actionbar = document.createElement('div');
  actionbar.className = 'pell-actionbar';
  actionbar.addEventListener('mousedown', e => e.preventDefault());
  element.append(actionbar);

  const content = document.createElement('div');
  content.contentEditable = 'true';
  content.className = 'pell-content';
  content.oninput = () => {
    if (content.firstChild?.nodeType === Node.TEXT_NODE) exec(formatBlock, `<${defaultParagraphSeparator}>`);
    else if (content.innerHTML === '<br>') content.innerHTML = '';
    onChange?.(content.innerHTML);
  };
  element.append(content);

  /* ---------- history ---------- */
  // A MutationObserver sees every change, whatever made it (typing, execCommand, direct DOM edits, async image inserts).
  // `undoStack` holds the state before each step; `last` is the state after the latest change.
  const path = (n: Node) => { const p: number[] = []; for (; n !== content && n.parentNode; n = n.parentNode) p.unshift([...n.parentNode.childNodes].indexOf(n as ChildNode)); return p };
  const node = (p: number[]) => p.reduce<Node | undefined>((n, i) => n?.childNodes[i], content);
  const snapshot = (): State => {
    const s = getSelection(), r = s?.rangeCount ? s.getRangeAt(0) : null;
    return { html: content.innerHTML, sel: r && content.contains(r.startContainer) && content.contains(r.endContainer) ? [path(r.startContainer), r.startOffset, path(r.endContainer), r.endOffset] : null };
  };
  let undoStack: State[] = [], redoStack: State[] = [], last = snapshot(), lastAt = 0, boundary = true;
  const buttons: Partial<Record<'undo' | 'redo', HTMLButtonElement>> = {};
  const updateButtons = () => {
    if (buttons.undo) buttons.undo.disabled = !undoStack.length;
    if (buttons.redo) buttons.redo.disabled = !redoStack.length;
  };
  const record = () => {
    if (content.innerHTML === last.html) return;
    const now = Date.now();
    if (boundary || now - lastAt > GROUP_MS) undoStack.push(last);
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
    last = snapshot();
    lastAt = now;
    boundary = false;
    updateButtons();
  };
  const observer = new MutationObserver(record);
  observer.observe(content, { childList: true, subtree: true, characterData: true, attributes: true });
  const restore = (s: State) => {
    content.innerHTML = s.html;
    observer.takeRecords();
    last = s;
    boundary = true;
    content.focus();
    const sel = getSelection()!, r = document.createRange();
    try {
      const [sp, so, ep, eo] = s.sel!;
      r.setStart(node(sp)!, so);
      r.setEnd(node(ep)!, eo);
    } catch { r.selectNodeContents(content); r.collapse(false) }
    sel.removeAllRanges();
    sel.addRange(r);
    updateButtons();
  };
  const step = (from: State[], to: State[]) => {
    observer.takeRecords();
    record(); // anything not yet recorded becomes its own step first
    const s = from.pop();
    if (!s) return;
    to.push({ ...last, sel: snapshot().sel });
    restore(s);
  };
  const ed: Editor = {
    content,
    undo: () => step(undoStack, redoStack),
    redo: () => step(redoStack, undoStack),
    resetHistory() { observer.takeRecords(); undoStack = []; redoStack = []; last = snapshot(); boundary = true; updateButtons() },
  };

  content.onkeydown = e => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) {
      e.preventDefault();
      if (k === 'y' || e.shiftKey) ed.redo(); else ed.undo();
      return;
    }
    if (e.key === 'Enter') boundary = true;
    if (e.key === 'Enter' && document.queryCommandValue(formatBlock) === 'blockquote') {
      setTimeout(() => exec(formatBlock, `<${defaultParagraphSeparator}>`), 0);
    }
  };
  // The browser's Edit menu / context menu undo.
  content.addEventListener('beforeinput', e => {
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); e.inputType === 'historyUndo' ? ed.undo() : ed.redo() }
    else if (/^(insertFrom|deleteBy)/.test(e.inputType)) boundary = true; // paste, drop, cut
  });
  // Pastes and drops handled by the page itself start a new step too.
  for (const t of ['paste', 'drop']) content.addEventListener(t, () => { boundary = true }, true);

  /** True when the cursor is inside an element matching `sel` within the editable area. */
  const within = (sel: string) => {
    const n = getSelection()?.anchorNode, m = (n instanceof Element ? n : n?.parentElement)?.closest(sel);
    return !!m && content.contains(m);
  };
  const states: Array<() => void> = [];
  const refresh = () => states.forEach(f => f());

  for (const action of list) {
    const button = document.createElement('button');
    button.className = 'pell-button';
    button.innerHTML = action.icon;
    button.title = action.title;
    button.type = 'button';
    button.onclick = () => {
      if (action.name !== 'undo' && action.name !== 'redo') { observer.takeRecords(); record(); boundary = true }
      if (action.result(ed)) content.focus();
      if (action.name !== 'undo' && action.name !== 'redo') { observer.takeRecords(); record(); boundary = true } // one step per action
      refresh();
    };
    if (action.name === 'undo' || action.name === 'redo') buttons[action.name] = button;
    if (action.active) { const sel = action.active; states.push(() => button.classList.toggle('pell-button-selected', within(sel))) }
    actionbar.append(button);
  }
  document.addEventListener('selectionchange', refresh);
  updateButtons();

  exec('defaultParagraphSeparator', defaultParagraphSeparator);
  return ed;
}
