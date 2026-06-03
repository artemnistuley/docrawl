import { parseHTML } from 'linkedom';

import { normalizeUrl } from './urls.js';

export function discoverLinks(html: string, baseUrl: string): string[] {
  const { document } = parseHTML(html);
  const anchors = [...document.querySelectorAll('a[href]')];
  const discovered = new Set<string>();

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href');
    if (href === null || href.trim() === '') {
      continue;
    }

    try {
      discovered.add(normalizeUrl(href, baseUrl));
    } catch {
      continue;
    }
  }

  return [...discovered];
}
