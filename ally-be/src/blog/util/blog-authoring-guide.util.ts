import {
  BLOG_DEFAULT_COVER_COLOR,
  BLOG_IMAGE_MAX_SIZE_BYTES,
} from '../constants/blog.constants';
import { BlogImageUploadContentType } from '../enum/blog-image-upload-content-type.enum';

/** The tags the blog's body sanitizer keeps (src/blog/util/sanitize-blog-html.util.ts). */
export const BLOG_BODY_TAGS = [
  'p',
  'strong',
  'em',
  'u',
  's',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'hr',
  'br',
  'a',
  'img',
] as const;

/** Swatches in the admin editor's cover palette (BlogSidePanel). */
export const BLOG_COVER_SWATCHES = [
  { value: '#8B9A6D', name: 'Sage' },
  { value: '#D8CFC0', name: 'Stone' },
  { value: '#B9A489', name: 'Sand' },
  { value: '#E4D7BC', name: 'Parchment' },
  { value: '#D97757', name: 'Clay' },
  { value: '#565045', name: 'Umber' },
] as const;

/** Markup the sanitizer would drop, found so the agent can fix it instead of losing it silently. */
const DROPPED_TAGS =
  /<(div|span|figure|figcaption|table|thead|tbody|tr|td|th|svg|script|style|iframe|video|audio|section|article|aside|details|summary|button|input|form|picture|source|canvas|link|meta)\b/gi;

export interface BodyIssue {
  problem: string;
  fix: string;
}

/** Problems in a body that the blog would strip or break. Empty means it is clean. */
export function findBodyIssues(html: string | null | undefined): BodyIssue[] {
  const issues: BodyIssue[] = [];
  const body = html ?? '';
  if (!body.trim()) return issues;
  const dropped = new Set(
    [...body.matchAll(DROPPED_TAGS)].map((m) => m[1].toLowerCase()),
  );
  if (dropped.size) {
    issues.push({
      problem: `Tags the blog removes: ${[...dropped].map((t) => `<${t}>`).join(', ')}`,
      fix: 'Use only the allowed tags. Put a picture in an <img>, and a caption in a <p><em> directly after it.',
    });
  }
  if (/<img\b[^>]*\bsrc\s*=\s*["']data:/i.test(body)) {
    issues.push({
      problem: 'An image uses a data: URL; the blog keeps only http(s) images.',
      fix: 'Upload the image with request_image_upload and use the returned imageUrl.',
    });
  }
  if (/\s(style|class|id|width|height)\s*=/i.test(body)) {
    issues.push({
      problem:
        'style, class, id, width and height attributes are removed. Only href, target and rel on links and src, alt and title on images stay.',
      fix: 'Size and style images in the picture itself, not in the markup.',
    });
  }
  if (/<img\b(?![^>]*\balt\s*=\s*["'][^"']+["'])[^>]*>/i.test(body)) {
    issues.push({
      problem: 'An image has no alt text.',
      fix: 'Give every image a short alt that says what it shows.',
    });
  }
  if (/<h1\b/i.test(body)) {
    issues.push({
      problem: 'The body has an <h1>; the post title is already the page h1.',
      fix: 'Start sections at <h2>.',
    });
  }
  return issues;
}

/** What an agent needs to know before it writes a post. Returned by the blog_guide tool. */
export function blogAuthoringGuide(
  existingTags: string[],
  skill: string | null = null,
) {
  return {
    skill:
      skill?.trim() ||
      '(The blog authoring skill could not be loaded. Follow the rules below and ask the person about anything unclear.)',
    what:
      'Ally Blog posts are platform-wide articles shown on app.helloally.ai/blog. You write DRAFTS. ' +
      'A person publishes in Ally admin → Blog; you cannot publish, unpublish or delete.',
    fields: {
      title:
        'Required, up to 255 characters. Say the claim or the topic plainly; no teaser titles.',
      slug: 'Optional. Made from the title when left out; kept unique for you.',
      tldr: 'Up to about 280 characters. The answer in one or two sentences; shown big under the title and in listings.',
      body: 'Rich-text HTML in the allowed tags only (below).',
      tags: `One to four tags. Reuse an existing tag exactly as written, capitalisation included; a tag already in use keeps its spelling. Existing: ${existingTags.length ? existingTags.join(', ') : '(none yet)'}.`,
      coverColor: `A #RRGGBB fill shown when there is no header image. The editor palette: ${BLOG_COVER_SWATCHES.map((s) => `${s.name} ${s.value}`).join(', ')}. Default ${BLOG_DEFAULT_COVER_COLOR}.`,
      authorName:
        'The byline, free text (for example the engineer who wrote it).',
      headerImageUrl:
        'An https image URL from request_image_upload. Wide (about 1200x630) works best.',
    },
    body: {
      allowedTags: BLOG_BODY_TAGS,
      linkAttributes: ['href', 'target', 'rel'],
      imageAttributes: ['src', 'alt', 'title'],
      notAllowed:
        'div, span, figure, figcaption, table, svg, iframe, video, style, class, id and inline styles. ' +
        'Anything else is removed when the post is saved; create_draft and update_draft list what they found.',
      headings:
        'The title is the page h1. Start at <h2>, use <h3> beneath it. Write headings that state the point.',
      images:
        'Every picture is an <img> with an https src and an alt. Put a caption in <p><em>…</em></p> right after it. ' +
        'Images cannot be laid side by side in the body, so combine pictures that belong together into one image.',
    },
    images: {
      how:
        '1) request_image_upload {fileName, contentType, fileSize} returns {presignedUrl, imageUrl}. ' +
        "2) Upload the file's bytes with curl -X PUT -H 'Content-Type: <contentType>' --data-binary @<file> '<presignedUrl>'. " +
        '3) Use imageUrl in the body or as headerImageUrl. Do not send image bytes through the tools.',
      contentTypes: Object.values(BlogImageUploadContentType),
      maxBytes: BLOG_IMAGE_MAX_SIZE_BYTES,
      advice:
        'Illustrate in the blog design only, as the skill describes: flow diagrams as SVG, product screens as PNG. ' +
        'Text inside an SVG shown through <img> cannot use web fonts: use a system font stack.',
    },
    voice:
      'Answer first: the opening paragraph says what the post is and why it matters, then the points in order of importance, then background. ' +
      'Plain words, short paragraphs, real numbers with their source and date, no marketing language. ' +
      'Match the spelling and tone of the posts already published.',
    flow:
      'blog_guide → (list_posts to avoid repeating a topic) → request_image_upload for each picture → create_draft → ' +
      'read the issues it returns and fix them with update_draft → tell the person to review and publish in Ally admin → Blog. ' +
      'A person may share the draft for review: when asked to apply suggestions, call list_suggestions, change the draft with update_draft, and say which suggestions you applied and which you did not.',
  };
}
