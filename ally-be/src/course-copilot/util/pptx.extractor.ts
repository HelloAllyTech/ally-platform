import { BadRequestException } from '@nestjs/common';
import {
  ExtractedDocument,
  ExtractedPage,
  ExtractedSection,
} from 'src/knowledge-base/extractor';

/**
 * PowerPoint (.pptx) text extraction for Course Copilot reference material.
 *
 * A .pptx is a ZIP of XML parts. Slides are read in PRESENTATION order (the `sldIdLst` in
 * `ppt/presentation.xml`, resolved through its relationships), not file-name order: a deck whose
 * slides were reordered keeps `slide7.xml` where slide 2 now sits. Each slide's speaker notes are
 * read too — partner training decks often carry the trainer's script there, which is most of the
 * teaching content.
 *
 * Every slide is one page (so a passage can be cited as "slide 4") and one section, titled by
 * its first line.
 */
export async function extractPptx(buffer: Buffer): Promise<ExtractedDocument> {
  // No `.default`: the repo compiles to CommonJS (see epub.extractor.ts).
  const JSZip = await import('jszip');
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new BadRequestException(
      `Could not open the PowerPoint file (${reason}). Save it as .pptx and try again.`,
    );
  }

  const read = async (path: string): Promise<string | null> => {
    const file = zip.file(path);
    return file ? file.async('string') : null;
  };

  const slidePaths = await slideOrder(zip, read);
  if (!slidePaths.length) {
    throw new BadRequestException(
      'This PowerPoint file has no slides that could be read.',
    );
  }

  let text = '';
  const pages: ExtractedPage[] = [];
  const sections: ExtractedSection[] = [];

  for (let index = 0; index < slidePaths.length; index += 1) {
    const slidePath = slidePaths[index];
    const xml = (await read(slidePath)) ?? '';
    const lines = paragraphs(xml);
    const notes = await slideNotes(slidePath, read);
    const number = index + 1;
    const title = lines[0] ?? `Slide ${number}`;
    const body = [
      ...lines,
      ...(notes.length ? ['', `Speaker notes: ${notes.join(' ')}`] : []),
    ]
      .join('\n')
      .trim();
    if (!body) continue;

    if (text) text += '\n\n';
    const start = text.length;
    text += body;
    pages.push({ number, start, end: text.length });
    sections.push({
      path: `Slide ${number}: ${title.slice(0, 120)}`,
      start,
      end: text.length,
    });
  }

  if (!text.trim()) {
    throw new BadRequestException(
      'No text was found in this PowerPoint file. Slides that are only images cannot be read yet.',
    );
  }
  return { text, pages, sections };
}

type Reader = (path: string) => Promise<string | null>;

/** Slide part paths in presentation order; file-number order when the manifest is unreadable. */
async function slideOrder(
  zip: { files: Record<string, unknown> },
  read: Reader,
): Promise<string[]> {
  const byNumber = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const presentation = await read('ppt/presentation.xml');
  const rels = await read('ppt/_rels/presentation.xml.rels');
  if (!presentation || !rels) return byNumber;

  const targets = relationshipTargets(rels);
  const ordered = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((match) => targets.get(match[1]))
    .filter((target): target is string => Boolean(target))
    .map((target) => resolvePath('ppt', target))
    .filter((path) => byNumber.includes(path));
  return ordered.length ? ordered : byNumber;
}

async function slideNotes(slidePath: string, read: Reader): Promise<string[]> {
  const folder = slidePath.slice(0, slidePath.lastIndexOf('/'));
  const name = slidePath.slice(slidePath.lastIndexOf('/') + 1);
  const rels = await read(`${folder}/_rels/${name}.rels`);
  if (!rels) return [];
  const notesTarget = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => /Type="[^"]*\/notesSlide"/.test(tag));
  const target = notesTarget?.match(/Target="([^"]+)"/)?.[1];
  if (!target) return [];
  const xml = await read(resolvePath(folder, target));
  if (!xml) return [];
  // The notes part repeats the slide number and an image placeholder; keep only real lines.
  return paragraphs(xml).filter((line) => !/^\d+$/.test(line));
}

/** The text of each `<a:p>` paragraph, in order, skipping empty ones. */
export function paragraphs(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const line = [...match[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((run) => decodeXml(run[1]))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) out.push(line);
  }
  return out;
}

function relationshipTargets(rels: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = match[0].match(/\bId="([^"]+)"/)?.[1];
    const target = match[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) targets.set(id, target);
  }
  return targets;
}

/** Resolve a relationship target ("slides/slide1.xml", "../notesSlides/n1.xml") against a folder. */
function resolvePath(folder: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = folder.split('/').filter(Boolean);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

function slideNumber(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&amp;/g, '&');
}
