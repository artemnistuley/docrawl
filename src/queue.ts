import { normalizeUrl } from './urls.js';

export interface QueueEntry {
  url: string;
  depth: number;
}

export class CrawlQueue {
  private readonly pending: QueueEntry[] = [];
  private readonly queued = new Set<string>();
  private readonly visited = new Set<string>();
  private readonly visitedFinalUrls = new Set<string>();

  enqueue(url: string, depth: number): boolean {
    const normalizedUrl = normalizeUrl(url);

    if (this.visited.has(normalizedUrl) || this.queued.has(normalizedUrl)) {
      return false;
    }

    this.pending.push({ url: normalizedUrl, depth });
    this.queued.add(normalizedUrl);
    return true;
  }

  dequeue(): QueueEntry | null {
    const next = this.pending.shift();
    if (next === undefined) {
      return null;
    }

    this.queued.delete(next.url);
    return next;
  }

  markVisited(url: string): void {
    this.visited.add(normalizeUrl(url));
  }

  markFinalVisited(finalUrl: string): void {
    this.visitedFinalUrls.add(normalizeUrl(finalUrl));
  }

  isVisited(url: string): boolean {
    return this.visited.has(normalizeUrl(url));
  }

  hasVisitedFinalUrl(finalUrl: string): boolean {
    return this.visitedFinalUrls.has(normalizeUrl(finalUrl));
  }

  size(): number {
    return this.pending.length;
  }

  isEmpty(): boolean {
    return this.pending.length === 0;
  }
}
