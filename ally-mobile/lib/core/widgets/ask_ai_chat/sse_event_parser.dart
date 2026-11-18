import 'dart:convert';

import 'ask_ai_chat_models.dart';

/// Port of RN `chatSessionManager.ts`'s `parseSSELine` / `parseSSEBuffer`:
/// text arrives in arbitrary chunks, events are separated by a blank line
/// (`\n\n`), and only `data: <json>` lines count. Anything that isn't valid
/// JSON after `data: ` (a `[DONE]` sentinel, a comment, a keep-alive) is
/// skipped exactly as RN's `try { JSON.parse } catch { return null }` does.
class SseEventParser {
  String _buffer = '';

  /// Feeds one decoded chunk; returns the events completed by it. A partial
  /// event at the end stays buffered until a later chunk finishes it.
  List<AskAiSseEvent> add(String chunk) {
    _buffer += chunk;
    final parts = _buffer.split('\n\n');
    _buffer = parts.removeLast();
    return _parseParts(parts);
  }

  /// RN's `onload` flush: whatever is left once the stream ends is parsed as
  /// if it had been terminated (`buffer + '\n\n'`).
  List<AskAiSseEvent> flush() {
    final remaining = _buffer;
    _buffer = '';
    if (remaining.trim().isEmpty) return const [];
    // The buffer never holds a `\n\n` (add() splits on it), so terminating
    // it leaves exactly one part.
    return _parseParts([remaining]);
  }

  /// True when unparsed text is still buffered (RN: `buffer.trim()`).
  bool get hasPending => _buffer.trim().isNotEmpty;

  static List<AskAiSseEvent> _parseParts(List<String> parts) {
    final events = <AskAiSseEvent>[];
    for (final part in parts) {
      for (final line in part.split('\n')) {
        final event = parseLine(line.trim());
        if (event != null) events.add(event);
      }
    }
    return events;
  }

  static AskAiSseEvent? parseLine(String line) {
    const prefix = 'data: ';
    if (!line.startsWith(prefix)) return null;
    try {
      final decoded = jsonDecode(line.substring(prefix.length));
      if (decoded is! Map<String, dynamic>) return null;
      return AskAiSseEvent.fromJson(decoded);
    } catch (_) {
      return null;
    }
  }
}
