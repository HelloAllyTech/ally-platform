// `import * as`, matching html.util.ts: the repo doesn't set esModuleInterop.
import * as sanitizeHtml from 'sanitize-html';
import { htmlToExtractedDocument } from '../../knowledge-base/extractor/html.util';

/** What the crawl needs from one page. */
export interface ParsedPage {
  title: string | null;
  canonical: string | null;
  text: string;
  headings: string[];
  links: string[];
  stylesheets: string[];
  meta: {
    themeColor: string | null;
    ogImage: string | null;
    robotsNoindex: boolean;
  };
  icons: { appleTouch: string | null; icon: string | null };
  /** An <img> that looks like the site's logo (in the header, or named "logo"). */
  logo: string | null;
  scriptCount: number;
  /** Inline CSS, for the brand colour. */
  inlineCss: string;
}

/**
 * Read one HTML page with sanitize-html's parser hooks (already a dependency; no DOM is built):
 * the links, the head's metadata, a logo candidate, and the main content as text and headings.
 * The main content is the first <main>, <article> or [role=main]; without one, the body minus its
 * navigation, header, footer and asides.
 */
export function parsePage(html: string): ParsedPage {
  const page: ParsedPage = {
    title: null,
    canonical: null,
    text: '',
    headings: [],
    links: [],
    stylesheets: [],
    meta: { themeColor: null, ogImage: null, robotsNoindex: false },
    icons: { appleTouch: null, icon: null },
    logo: null,
    scriptCount: 0,
    inlineCss: '',
  };
  const stack: string[] = [];
  let inTitle = false;
  let inStyle = false;
  let title = '';

  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['script', 'noscript', 'template'],
    onOpenTag: (name: string, attribs: Record<string, string>) => {
      stack.push(name);
      const rel = (attribs.rel ?? '').toLowerCase();
      if (name === 'title') inTitle = true;
      if (name === 'style') inStyle = true;
      if (name === 'script') page.scriptCount += 1;
      if (name === 'a' && attribs.href) page.links.push(attribs.href);
      if (name === 'link') {
        if (rel.split(/\s+/).includes('canonical') && attribs.href)
          page.canonical = attribs.href;
        if (rel.includes('apple-touch-icon') && attribs.href)
          page.icons.appleTouch ??= attribs.href;
        if (/(^|\s)(shortcut )?icon(\s|$)/.test(rel) && attribs.href)
          page.icons.icon ??= attribs.href;
        if (rel.includes('stylesheet') && attribs.href)
          page.stylesheets.push(attribs.href);
      }
      if (name === 'meta') {
        const key = (attribs.name ?? attribs.property ?? '').toLowerCase();
        if (key === 'theme-color' && attribs.content)
          page.meta.themeColor ??= attribs.content.trim();
        if (key === 'og:image' && attribs.content)
          page.meta.ogImage ??= attribs.content.trim();
        if (key === 'robots' && /noindex/i.test(attribs.content ?? ''))
          page.meta.robotsNoindex = true;
      }
      if (name === 'img' && !page.logo && attribs.src) {
        const label =
          `${attribs.class ?? ''} ${attribs.id ?? ''} ${attribs.alt ?? ''} ${attribs.src}`.toLowerCase();
        if (label.includes('logo') || stack.includes('header'))
          page.logo = attribs.src;
      }
    },
    onCloseTag: (name: string) => {
      if (name === 'title') inTitle = false;
      if (name === 'style') inStyle = false;
      const at = stack.lastIndexOf(name);
      if (at >= 0) stack.length = at;
    },
    textFilter: (text: string) => {
      if (inTitle) title += text;
      if (inStyle) page.inlineCss += text;
      return '';
    },
  } as sanitizeHtml.IOptions);

  page.title = title.replace(/\s+/g, ' ').trim() || null;
  const extracted = htmlToExtractedDocument(mainContent(html));
  page.text = extracted.text;
  page.headings = extracted.sections
    .map((s) => s.path.split(' > ').pop() ?? s.path)
    .slice(0, 30);
  return page;
}

/** The main region's HTML, or the body without its navigation, header, footer and asides. */
export function mainContent(html: string): string {
  const main =
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html) ??
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html) ??
    /<[a-z]+\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/[a-z]+>/i.exec(html);
  if (main) return main[1];
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
}
