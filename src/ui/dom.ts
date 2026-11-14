// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/** Tiny hyperscript helper: `h('div.panel', { title: 'x' }, child, 'text')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: `${K}${string}` | K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void)> | null = null,
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag as K);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value === 'function') el.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
      else if (value === true) el.setAttribute(key, '');
      else if (value !== false) el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Sets text only when it changed, avoiding needless layout work in per-frame updates. */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** True when the player asked the system for less motion: animations then show their end state. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
