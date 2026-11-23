import * as fs from 'fs';
import * as path from 'path';

const cache = new Map<string, unknown>();

/**
 * Read one of Course Copilot's checked-in data files (src/course-copilot/data/<name>), once, lazily.
 * Compiled code runs from dist/, which does not carry the JSON; the source tree ships in the image
 * (as src/prompts does), so fall back to it. A missing file gives `fallback`, never a throw: the
 * knowledge is an aid, and Copilot works without it.
 */
export function loadCourseCopilotData<T>(name: string, fallback: T): T {
  if (cache.has(name)) return cache.get(name) as T;
  const candidates = [
    path.join(__dirname, '..', 'data', name),
    path.join(process.cwd(), 'src', 'course-copilot', 'data', name),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const value = JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    cache.set(name, value);
    return value;
  }
  cache.set(name, fallback);
  return fallback;
}

const STOPWORDS = new Set(
  (
    'a an and are as at be by for from in is it of on or our the their they this to use who with ' +
    'if not no we want what how when do does should can i you your my me about into than then so'
  ).split(' '),
);

/** Lower-case word stems for keyword matching (plural "-s"/"-ies" folded). */
export function searchTokens(text: string): string[] {
  return (
    String(text ?? '')
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  )
    .map((token) => token.replace(/ies$/, 'y').replace(/s$/, ''))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}
