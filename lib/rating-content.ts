import type { Rating } from '@/lib/house-ranker';

export type RatingSource = { title: string; url: string };

const markdownLinkPattern = /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/gi;

export function ratingContent(
  text: string,
  sources: Rating['sources'] = [],
): { text: string; sources: RatingSource[] } {
  const inlineSources: RatingSource[] = [];
  const plainText = text.replace(
    markdownLinkPattern,
    (_match, title: string, url: string) => {
      inlineSources.push({ title: title.trim(), url });
      return title.trim();
    },
  );
  const sourcesByUrl = new Map<string, RatingSource>();
  for (const source of [...(sources ?? []), ...inlineSources]) {
    const normalized = normalizeSource(source);
    if (!normalized || sourcesByUrl.has(normalized.url)) continue;
    sourcesByUrl.set(normalized.url, normalized);
  }
  return {
    text: plainText.replace(/[ \t]{2,}/g, ' ').trim(),
    sources: [...sourcesByUrl.values()],
  };
}

function normalizeSource(source: RatingSource): RatingSource | null {
  try {
    const url = new URL(source.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.searchParams.delete('utm_source');
    url.searchParams.delete('utm_medium');
    url.searchParams.delete('utm_campaign');
    url.searchParams.delete('utm_content');
    url.searchParams.delete('utm_term');
    return {
      title: source.title.trim() || url.hostname.replace(/^www\./, ''),
      url: url.toString(),
    };
  } catch {
    return null;
  }
}
