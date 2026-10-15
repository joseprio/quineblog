// Automatic snapshots: every change saves the blog's data to localStorage. There is one snapshot per page load (a session);
// later changes in the same session replace it. Settings → Restore lists them.
import { type BlogData, exportData, importData } from './content';
import { isDirty, onDirty, setDirty } from './state';

export interface Snapshot { key: string; date: Date; posts: number; current: boolean }
interface Stored { date: string; data: BlogData }

/** Per page, so several blogs served from one origin (or opened as files) keep separate snapshots. */
const PREFIX = `quine-snapshot:${location.pathname}:`;
const MAX = 20;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let session = newId(), quiet = false;

function read(key: string): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null') as Stored | null;
    return s && typeof s.date === 'string' && s.data?.format === 'quine-blog' ? s : null;
  } catch {
    return null;
  }
}

const remove = (key: string) => { try { localStorage.removeItem(key) } catch { /* storage blocked */ } };

/** This page's snapshots, newest first. */
export function snapshots(): Snapshot[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) keys.push(k) }
  } catch { /* storage blocked */ }
  return keys.flatMap(key => {
    const s = read(key);
    return s ? [{ key, date: new Date(s.date), posts: s.data.posts.length, current: key === PREFIX + session }] : [];
  }).sort((x, y) => +y.date - +x.date);
}

/** Saves the current data as this session's snapshot, dropping the oldest others when storage is full. */
function save() {
  const key = PREFIX + session, value = JSON.stringify({ date: new Date().toISOString(), data: exportData() } satisfies Stored);
  for (;;) {
    try {
      localStorage.setItem(key, value);
      break;
    } catch {
      const oldest = snapshots().filter(s => !s.current).pop();
      if (!oldest) return; // doesn't fit even alone, or storage is blocked
      remove(oldest.key);
    }
  }
  snapshots().slice(MAX).forEach(s => remove(s.key));
}

/** Changes after this go to a new snapshot, keeping the current one. Used before replacing everything (import, delete all). */
export function newSession() {
  session = newId();
}

/** Replaces all content with a snapshot. The snapshot is kept as it is; changes after this start a new one. */
export function restore(key: string) {
  const s = read(key);
  if (!s) throw new Error('This snapshot can no longer be read.');
  importData(s.data);
  newSession();
  quiet = true;
  try { setDirty(true) } finally { quiet = false }
}

export function clearSnapshots() {
  snapshots().forEach(s => remove(s.key));
}

export function startSnapshots() {
  onDirty(() => { if (isDirty() && !quiet) save() });
}
