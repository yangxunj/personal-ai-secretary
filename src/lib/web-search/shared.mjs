import { z } from 'zod';
import { publicWebUrl } from './url.mjs';

export const webSearchInput = z.object({ query: z.string().trim().min(1).max(128), count: z.number().int().min(1).max(5).default(5) });
export const fetchWebPageInput = z.object({ url: z.string().min(1).max(8192) });

// Provider text is untrusted data. Only public URLs become usable citations.
export function projectSearchResults(data, count) {
  if (!Array.isArray(data?.results)) throw new Error('Invalid search response');
  return data.results.slice(0, count).flatMap(row => {
    if (typeof row?.title !== 'string' || typeof row?.url !== 'string') return [];
    let url; try { url = publicWebUrl(row.url); } catch { return []; }
    return [{ title: row.title.slice(0, 200), url,
      snippet: typeof row.snippet === 'string' ? row.snippet.slice(0, 1000) : '',
      summary: typeof row.summary === 'string' ? row.summary.slice(0, 2000) : '' }];
  });
}
export function projectWebPage(data, limit = 24000) {
  if (typeof data?.content !== 'string' || typeof data?.title !== 'string') throw new Error('Invalid web page response');
  if (!data.content.trim()) return null;
  return { title: data.title.slice(0, 200), content: data.content.slice(0, limit), truncated: data.content.length > limit, totalCharacters: data.content.length };
}
