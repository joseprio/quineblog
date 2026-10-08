// Unsaved-changes flag, plus listeners so the author toolbar can reflect it.
let dirty = false;
const listeners: Array<() => void> = [];

export const isDirty = () => dirty;
export const onDirty = (fn: () => void) => listeners.push(fn);
export function setDirty(v: boolean) {
  dirty = v;
  listeners.forEach(fn => fn());
}
