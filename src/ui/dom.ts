/** DOM を組み立てるための小道具。 */

export function $<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`要素が見つかりません: ${selector}`);
  return node;
}

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  children: Child | Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { dataset, ...rest } = props as Record<string, unknown> & {
    dataset?: Record<string, string>;
  };
  Object.assign(node, rest);
  if (dataset) for (const [k, v] of Object.entries(dataset)) node.dataset[k] = v;

  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, isError = false): void {
  document.querySelector('.toast')?.remove();
  const node = el('div', { className: `toast${isError ? ' err' : ''}`, textContent: message });
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 3600);
}
