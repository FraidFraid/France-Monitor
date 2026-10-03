// src/components/layer-panel/morph.ts : mise à jour d'un panneau de couche sans reconstruire ce qui n'a pas changé (spec
// 2026-10-03 trafics § 3.4) : un nœud identique est gardé tel quel, ce qui préserve le focus, un menu déroulant ouvert, le curseur
// d'une saisie et le défilement ; seuls les nœuds qui diffèrent sont mis à jour ou remplacés. Pas de bibliothèque : le contenu
// des panneaux est produit par les vues pures, en HTML déjà échappé.

/** Attributs qui identifient un nœud : un élément d'une autre identité (autre section, autre navire, autre onglet) est remplacé. */
const KEY_ATTRIBUTES = ['data-section', 'data-tab', 'data-mar-ship', 'data-rail-train', 'data-road-event', 'id'] as const;

function keyOf(el: Element): string | null {
  for (const name of KEY_ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value !== null) return `${name}=${value}`;
  }
  return null;
}

function sameIdentity(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  return !(a instanceof Element && b instanceof Element) || keyOf(a) === keyOf(b);
}

function morphNode(from: Node, to: Node): void {
  if (!(from instanceof Element) || !(to instanceof Element)) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  if (from.isEqualNode(to)) return;
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  morphChildren(from, to);
}

/** Donne aux enfants de `from` la forme de ceux de `to`, nœud par nœud, en gardant ceux de même identité. */
export function morphChildren(from: Node, to: Node): void {
  let current = from.firstChild;
  for (const wanted of [...to.childNodes]) {
    if (current === null) {
      from.appendChild(wanted);
      continue;
    }
    if (sameIdentity(current, wanted)) {
      morphNode(current, wanted);
      current = current.nextSibling;
    } else {
      const next = current.nextSibling;
      from.replaceChild(wanted, current);
      current = next;
    }
  }
  while (current !== null) {
    const next: ChildNode | null = current.nextSibling;
    from.removeChild(current);
    current = next;
  }
}

/** Met le contenu de `target` à celui de `html`, en gardant les nœuds inchangés. */
export function morphInto(target: Element, html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  morphChildren(target, template.content);
}
