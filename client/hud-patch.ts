const KEY_ATTRIBUTES = ['data-action', 'data-weapon', 'data-kind', 'data-team', 'data-world', 'data-keep', 'data-seed'];

/** Patch the live HUD without detaching controls between pointerdown and pointerup. */
export function patchHUD(root: HTMLElement, html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  patchChildren(root, template.content);
}

function identity(node: Node) {
  if (!(node instanceof Element)) return node.nodeName;
  const id = node.getAttribute('id');
  if (id) return `${node.nodeName}#${id}`;
  const key = KEY_ATTRIBUTES.filter(name => node.hasAttribute(name)).map(name => `${name}=${node.getAttribute(name)}`).join(':');
  return `${node.namespaceURI}:${node.nodeName}:${key || (node.getAttribute('class') ?? '').split(/\s+/)[0]}`;
}

function patchChildren(parent: Node, desired: Node) {
  let cursor = parent.firstChild;
  for (const next of Array.from(desired.childNodes)) {
    const key = identity(next);
    let match = cursor;
    while (match && identity(match) !== key) match = match.nextSibling;
    if (!match) {
      parent.insertBefore(next, cursor);
      continue;
    }
    if (match !== cursor) parent.insertBefore(match, cursor);
    patchNode(match, next);
    cursor = match.nextSibling;
  }
  while (cursor) { const following = cursor.nextSibling; parent.removeChild(cursor); cursor = following; }
}

function patchNode(current: Node, next: Node) {
  if (current.isEqualNode(next)) return;
  if (current instanceof Element && next instanceof Element) {
    for (const attribute of Array.from(current.attributes)) if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    for (const attribute of Array.from(next.attributes)) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    patchChildren(current, next);
  } else if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
}
