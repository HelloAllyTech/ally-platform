/**
 * robots.txt, as RFC 9309 describes it, for one user agent: the group that names us (else `*`),
 * Allow and Disallow rules matched by longest path, `*` and `$` in patterns. Small and in-repo:
 * the crawl only needs "may we read this path?", and the sitemaps listed.
 */
export const CRAWLER_USER_AGENT = 'AllyAssistantSetup';

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

export interface Robots {
  allows(pathAndQuery: string): boolean;
  sitemaps: string[];
}

export function parseRobots(text: string, agent = CRAWLER_USER_AGENT): Robots {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow means "everything is allowed": no rule.
      if (!value) continue;
      current.rules.push({
        allow: field === 'allow',
        pattern: value,
        regex: toRegex(value),
      });
    }
  }

  const me = agent.toLowerCase();
  const group =
    groups.find((g) => g.agents.some((a) => a !== '*' && me.includes(a))) ??
    groups.find((g) => g.agents.includes('*'));
  const rules = group?.rules ?? [];

  return {
    sitemaps,
    allows(pathAndQuery: string) {
      const path = pathAndQuery || '/';
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!rule.regex.test(path)) continue;
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length &&
            rule.allow &&
            !best.allow)
        ) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}
