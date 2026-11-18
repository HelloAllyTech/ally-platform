/// Port of RN `SimulationFeedbackScreen/components/Debrief/debriefSections.ts`.
///
/// Ally writes the debrief as one note but marks its structure with machine
/// keys on their own line (`## [what_worked]`), never translated headings;
/// the app owns the visible label. A note with no keys (older notes, or a
/// drifting generation) falls back to one unlabelled block.
library;

/// Keys with a visible heading, in the order Ally writes them.
const labelledDebriefSectionKeys = ['what_worked', 'what_it_cost', 'try_next'];

/// `closing` is a structural marker (the invitation to reply), not a heading.
const debriefSectionKeys = [...labelledDebriefSectionKeys, 'closing'];

class DebriefSection {
  DebriefSection(this.key, this.paragraphs);

  /// Null for the unlabelled opening, or the whole note when it has no keys.
  final String? key;
  final List<String> paragraphs;

  bool get isLabelled => key != null && labelledDebriefSectionKeys.contains(key);
}

final _keys = debriefSectionKeys.join('|');

/// Forgiving about everything but the key itself: `##`, bold, brackets,
/// colon and case are all optional.
final _sectionHeading = RegExp(
  r'^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*\[?\s*(' + _keys + r')\s*\]?\s*(?:\*\*|__)?\s*:?\s*$',
  caseSensitive: false,
);

/// The same key written inline before the prose (`## [what_worked] You…`).
final _inlineSectionHeading = RegExp(
  r'^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*\[\s*(' + _keys + r')\s*\]\s*(?:\*\*|__)?\s*:?\s*',
  caseSensitive: false,
);

/// Splits a note into sections, keeping paragraph breaks within each. A
/// heading with nothing under it is dropped; a repeated key folds into the
/// section already on screen.
List<DebriefSection> parseDebriefSections(String note) {
  final sections = <DebriefSection>[];
  String? key;
  var paragraphs = <String>[];
  var lines = <String>[];

  void flushParagraph() {
    final paragraph = lines.join('\n').trim();
    if (paragraph.isNotEmpty) paragraphs.add(paragraph);
    lines = [];
  }

  void flushSection() {
    flushParagraph();
    if (paragraphs.isNotEmpty) {
      final existing = key == null ? null : sections.where((s) => s.key == key).firstOrNull;
      if (existing != null) {
        existing.paragraphs.addAll(paragraphs);
      } else {
        sections.add(DebriefSection(key, paragraphs));
      }
    }
    paragraphs = [];
  }

  for (final line in note.split('\n')) {
    final heading = _sectionHeading.firstMatch(line);
    if (heading != null) {
      flushSection();
      key = heading[1]!.toLowerCase();
      continue;
    }
    final inline = _inlineSectionHeading.firstMatch(line);
    if (inline != null) {
      flushSection();
      key = inline[1]!.toLowerCase();
      lines.add(line.substring(inline[0]!.length));
      continue;
    }
    if (line.trim().isEmpty) {
      flushParagraph();
      continue;
    }
    lines.add(line);
  }
  flushSection();
  return sections;
}

/// One run of a note line: plain text, `**bold**`, or a `[[msg:<id>]]`
/// moment anchor (RN `SupervisorNote.parseSegments`).
sealed class NoteSegment {
  const NoteSegment();
}

class NoteText extends NoteSegment {
  const NoteText(this.value);
  final String value;
}

class NoteBold extends NoteSegment {
  const NoteBold(this.value);
  final String value;
}

class NoteMoment extends NoteSegment {
  const NoteMoment(this.messageId);
  final String messageId;
}

final _noteSegment = RegExp(r'\[\[msg:([^\]]+)\]\]|\*\*(.+?)\*\*');

List<NoteSegment> parseNoteSegments(String line) {
  final segments = <NoteSegment>[];
  var cursor = 0;
  for (final match in _noteSegment.allMatches(line)) {
    if (match.start > cursor) segments.add(NoteText(line.substring(cursor, match.start)));
    if (match[1] != null) {
      segments.add(NoteMoment(match[1]!.trim()));
    } else if (match[2] != null) {
      segments.add(NoteBold(match[2]!));
    }
    cursor = match.end;
  }
  if (cursor < line.length) segments.add(NoteText(line.substring(cursor)));
  return segments;
}
