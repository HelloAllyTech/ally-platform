import * as JSZip from 'jszip';
import { extractPptx, paragraphs } from '../pptx.extractor';

const slideXml = (...lines: string[]) =>
  `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${lines
    .map(
      (line) =>
        `<p:sp><p:txBody><a:p><a:r><a:t>${line}</a:t></a:r></a:p></p:txBody></p:sp>`,
    )
    .join('')}</p:spTree></p:cSld></p:sld>`;

/**
 * A minimal deck: slide files 1 and 2, presented in the order 2 then 1 (a reordered deck),
 * with speaker notes on slide 2.
 */
async function deck(options: { manifest?: boolean } = {}): Promise<Buffer> {
  const zip = new (JSZip as any)();
  zip.file(
    'ppt/slides/slide1.xml',
    slideXml('Safety planning', 'Remove means &amp; list contacts'),
  );
  zip.file(
    'ppt/slides/slide2.xml',
    slideXml('Asking directly', 'Use the word suicide'),
  );
  zip.file(
    'ppt/slides/_rels/slide2.xml.rels',
    '<Relationships><Relationship Id="rId2" Type="http://schemas/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
  );
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    `<p:notes xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Pause after asking.</a:t></a:r></a:p><a:p><a:r><a:t>2</a:t></a:r></a:p></p:notes>`,
  );
  if (options.manifest !== false) {
    zip.file(
      'ppt/presentation.xml',
      '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId9"/><p:sldId id="257" r:id="rId8"/></p:sldIdLst></p:presentation>',
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      '<Relationships><Relationship Id="rId8" Target="slides/slide1.xml"/><Relationship Id="rId9" Target="slides/slide2.xml"/></Relationships>',
    );
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extractPptx', () => {
  it('reads slides in presentation order, one page and section per slide', async () => {
    const doc = await extractPptx(await deck());

    expect(doc.text.indexOf('Asking directly')).toBeLessThan(
      doc.text.indexOf('Safety planning'),
    );
    expect(doc.pages.map((p) => p.number)).toEqual([1, 2]);
    expect(doc.sections.map((s) => s.path)).toEqual([
      'Slide 1: Asking directly',
      'Slide 2: Safety planning',
    ]);
    expect(doc.text.slice(doc.pages[1].start, doc.pages[1].end)).toContain(
      'Safety planning',
    );
  });

  it("includes speaker notes, without the notes page's slide number", async () => {
    const doc = await extractPptx(await deck());
    expect(doc.text).toContain('Speaker notes: Pause after asking.');
    expect(doc.text).not.toMatch(/Speaker notes: .*\b2\b/);
  });

  it('decodes XML entities', async () => {
    const doc = await extractPptx(await deck());
    expect(doc.text).toContain('Remove means & list contacts');
  });

  it('falls back to file order when the manifest is missing', async () => {
    const doc = await extractPptx(await deck({ manifest: false }));
    expect(doc.sections[0].path).toBe('Slide 1: Safety planning');
  });

  it('refuses a file that is not a .pptx', async () => {
    await expect(extractPptx(Buffer.from('not a zip'))).rejects.toThrow(
      'Could not open the PowerPoint file',
    );
  });
});

describe('paragraphs', () => {
  it('joins the runs of a paragraph and skips empty ones', () => {
    expect(
      paragraphs(
        '<a:p><a:r><a:t>Ask </a:t></a:r><a:r><a:t>directly</a:t></a:r></a:p><a:p></a:p>',
      ),
    ).toEqual(['Ask directly']);
  });
});
