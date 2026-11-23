#!/usr/bin/env node
/**
 * Builds src/course-copilot/data/example-courses.json: the courses Course Copilot's planner may
 * learn from, as compact outlines (sections, item types, titles, sizes, completion rules), never
 * full article text or learner data.
 *
 * Input: one or more course JSON files as returned by the admin API
 * (GET /api/v1/learn/admin/tracks/:id). Which courses count as examples is a person's decision;
 * re-run this when an example course changes.
 *
 *   node scripts/course-copilot/build-example-courses.mjs course-a.json course-b.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(
  here,
  '..',
  '..',
  'src',
  'course-copilot',
  'data',
  'example-courses.json',
);

const text = (html, max = 400) => {
  const plain = String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};
const words = (html) => (text(html, 1e9).match(/\S+/g) ?? []).length;
const len = (value) => (Array.isArray(value) ? value.length : 0);
const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** One line on how big the item is, by type. */
function sizeOf(item) {
  const c = item.content ?? {};
  switch (item.type) {
    case 'ARTICLE':
      return `${words(c.html)} words${len(c.questions) ? `, ${len(c.questions)} inline checks` : ''}`;
    case 'QUIZ':
      return `${len(c.questions)} question${len(c.questions) === 1 ? '' : 's'}`;
    case 'JOURNAL':
      return `${len(c.prompts)} prompt${len(c.prompts) === 1 ? '' : 's'}`;
    case 'VIDEO':
      return `${Math.round((c.durationSeconds ?? 0) / 60)} min video${len(c.interjections) ? `, ${len(c.interjections)} pauses with a question` : ''}`;
    case 'ANNOTATED_ARTIFACT':
      return `${len(c.units)} lines to mark with ${len(c.labels)} labels`;
    case 'BUCKET_SORT':
      return `${len(c.items)} items into ${(c.buckets ?? []).map((b) => b.label).join(' / ')}`;
    case 'BRANCHING_SCENARIO': {
      const nodes = c.nodes ?? [];
      const endings = nodes.filter((n) => !len(n.choices)).length;
      return `${nodes.length} scenes, ${endings} endings`;
    }
    case 'GAME':
      return c.gameKey ? `game: ${c.gameKey}` : 'game';
    case 'ROLEPLAY':
      return 'voice roleplay';
    case 'CASE':
      return 'roleplay chain';
    default:
      return '';
  }
}

function ruleOf(item) {
  const rule = item.completionCriteria;
  if (!rule || typeof rule !== 'object') return undefined;
  const parts = Object.entries(rule)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k} ${v}`);
  return parts.length ? parts.join(', ') : undefined;
}

function outline(raw) {
  const track = raw.data ?? raw;
  const sections = [...(track.sections ?? [])]
    .filter((s) => !s.deletedAt)
    .sort((a, b) => a.order - b.order);
  const typeCounts = {};
  const outSections = sections.map((section) => ({
    title: section.title,
    ...(text(section.description, 200)
      ? { description: text(section.description, 200) }
      : {}),
    items: [...(section.items ?? [])]
      .filter((i) => !i.deletedAt)
      .sort((a, b) => a.order - b.order)
      .map((item) => {
        typeCounts[item.type] = (typeCounts[item.type] ?? 0) + 1;
        const note = text(
          item.description || item.content?.intro || '',
          160,
        );
        const rule = ruleOf(item);
        return {
          type: item.type,
          title: item.title,
          size: sizeOf(item),
          ...(note ? { note } : {}),
          ...(rule ? { rule } : {}),
        };
      }),
  }));
  return {
    id: slug(track.title),
    sourceTrackId: track.id,
    title: track.title,
    summary: text(track.description, 600),
    progressionMode: track.progressionMode ?? null,
    sectionCount: outSections.length,
    itemCount: outSections.reduce((n, s) => n + s.items.length, 0),
    typeCounts,
    sections: outSections,
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: build-example-courses.mjs <course.json> [...]');
  process.exit(1);
}
const courses = files.map((file) =>
  outline(JSON.parse(fs.readFileSync(file, 'utf-8'))),
);
fs.writeFileSync(OUT, `${JSON.stringify(courses, null, 2)}\n`);
for (const c of courses) {
  console.log(
    `${c.id}: ${c.sectionCount} sections, ${c.itemCount} items (${JSON.stringify(c.typeCounts)})`,
  );
}
console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
