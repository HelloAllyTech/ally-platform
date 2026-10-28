import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/simulations/presentation/widgets/feedback/debrief_sections.dart';

void main() {
  group('parseDebriefSections (RN debriefSections.ts)', () {
    test('a note without keys is one unlabelled section, paragraphs kept', () {
      final sections = parseDebriefSections('First para.\n\nSecond para.');
      expect(sections.single.key, isNull);
      expect(sections.single.paragraphs, ['First para.', 'Second para.']);
    });

    test('keys split the note; tolerant spellings still count', () {
      final sections = parseDebriefSections(
        'Hello.\n## [what_worked]\nGood.\n**What_It_Cost**:\nTime.\ntry_next\nSlow down.\n[closing]\nReply!',
      );
      expect(sections.map((s) => s.key), [null, 'what_worked', 'what_it_cost', 'try_next', 'closing']);
      expect(sections[1].isLabelled, isTrue);
      expect(sections[4].isLabelled, isFalse);
    });

    test('an inline key becomes the heading and the rest of the line its prose', () {
      final sections = parseDebriefSections('## [what_worked] You listened well.');
      expect(sections.single.key, 'what_worked');
      expect(sections.single.paragraphs.single, 'You listened well.');
    });

    test('empty headings are dropped and repeated keys fold together', () {
      final sections = parseDebriefSections('## [what_worked]\n\n## [try_next]\nA\n## [try_next]\nB');
      expect(sections.single.key, 'try_next');
      expect(sections.single.paragraphs, ['A', 'B']);
    });
  });

  test('parseNoteSegments splits text, bold and moment anchors', () {
    final segments = parseNoteSegments('You **paused** here [[msg: 42 ]] nicely');
    expect(segments, hasLength(5));
    expect((segments[1] as NoteBold).value, 'paused');
    expect((segments[3] as NoteMoment).messageId, '42');
  });
}
