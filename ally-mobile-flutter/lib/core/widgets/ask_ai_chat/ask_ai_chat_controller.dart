import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'ask_ai_chat_api.dart';
import 'ask_ai_chat_models.dart';

/// Port of RN `chatSessionManager.ts` + `useAskAIChat.ts` for one scenario
/// session: history loads once, a send appends the learner's message and
/// streams Ally's reply into [streamingMessage] token by token, and the
/// finished reply is committed to [messages].
///
/// RN keeps this in a module-level store so a remounted tab finds the same
/// thread; here the owning screen holds the controller for its lifetime
/// instead (tab switches don't recreate it), and [dispose] cancels any
/// in-flight stream, as RN's `destroySession` aborts its XHR.
class AskAiChatController extends ChangeNotifier {
  AskAiChatController({required AskAiChatApi api, required this.sessionId}) : _api = (() => api);

  /// Resolves the API on first use, so a screen that never loads or sends
  /// (read-only debrief, tests) doesn't need a configured API client.
  AskAiChatController.lazy({required AskAiChatApi Function() api, required this.sessionId}) : _api = api;

  final AskAiChatApi Function() _api;

  /// Empty means "no thread" — RN's own no-op path (`useAskAIChat` only
  /// loads history for a truthy session id), used by the read-only debrief.
  final String sessionId;

  List<AskAiChatMessage> _messages = const [];
  AskAiChatMessage? _streamingMessage;
  bool _isStreaming = false;
  bool _isLoading = false;
  bool _isHistoryLoaded = false;
  String? _error;
  bool _disposed = false;

  CancelToken? _cancelToken;
  StreamSubscription<AskAiSseEvent>? _subscription;

  /// Committed messages (history + completed exchanges).
  List<AskAiChatMessage> get messages => _messages;

  /// The reply being streamed, or null.
  AskAiChatMessage? get streamingMessage => _streamingMessage;

  /// RN's `allMessages`: committed messages plus the in-progress reply.
  List<AskAiChatMessage> get allMessages =>
      _streamingMessage == null ? _messages : [..._messages, _streamingMessage!];

  bool get isStreaming => _isStreaming;
  bool get isLoading => _isLoading;
  bool get isHistoryLoaded => _isHistoryLoaded;
  String? get error => _error;

  /// RN's `isInterrupted`: the last committed message is the learner's and
  /// nothing is streaming (the reply never arrived).
  bool get isInterrupted =>
      _messages.isNotEmpty && _messages.last.role == AskAiChatRole.user && !_isStreaming;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// Loads the thread once. Failures are swallowed (RN only logs them) and
  /// still mark the history as loaded, so the empty state shows.
  Future<void> loadHistory() async {
    if (sessionId.isEmpty || _isHistoryLoaded || _isLoading) return;
    _isLoading = true;
    _notify();
    try {
      final history = await _api().getHistory(sessionId);
      if (_disposed) return;
      _messages = history;
    } catch (_) {
      // RN: logger.error only.
    } finally {
      _isLoading = false;
      _isHistoryLoaded = true;
      _notify();
    }
  }

  void sendMessage(String text) {
    final trimmed = text.trim();
    if (sessionId.isEmpty || trimmed.isEmpty || _isStreaming) return;
    _error = null;
    _messages = [..._messages, _newMessage(AskAiChatRole.user, trimmed)];
    _notify();
    _startStream(trimmed);
  }

  /// Re-sends the last learner message (RN `retry`).
  void retry() {
    if (_isStreaming) return;
    final lastUser = _messages.lastWhere(
      (m) => m.role == AskAiChatRole.user,
      orElse: () => _newMessage(AskAiChatRole.assistant, ''),
    );
    if (lastUser.role != AskAiChatRole.user) return;
    _error = null;
    _notify();
    _startStream(lastUser.content);
  }

  static int _tempCounter = 0;

  AskAiChatMessage _newMessage(AskAiChatRole role, String content) {
    final now = DateTime.now();
    return AskAiChatMessage(
      id: 'temp_${now.microsecondsSinceEpoch}_${_tempCounter++}',
      role: role,
      content: content,
      createdAt: now.toIso8601String(),
      isStreaming: role == AskAiChatRole.assistant,
    );
  }

  void _startStream(String content) {
    _streamingMessage = _newMessage(AskAiChatRole.assistant, '');
    _isStreaming = true;
    _error = null;
    _notify();

    final cancelToken = CancelToken();
    _cancelToken = cancelToken;
    var complete = false;

    void finish() {
      _subscription = null;
      _cancelToken = null;
      _isStreaming = false;
      _notify();
    }

    Stream<AskAiSseEvent> stream;
    try {
      stream = _api().streamChat(sessionId, content, cancelToken: cancelToken);
    } catch (_) {
      stream = Stream.error(const AskAiChatException(AskAiChatApi.networkErrorMessage));
    }
    _subscription = stream.listen(
          (event) {
            if (complete || _disposed) return;
            final streaming = _streamingMessage;
            switch (event) {
              case AskAiSseStart():
                break;
              case AskAiSseToken(:final content):
                if (streaming != null) {
                  _streamingMessage = streaming.copyWith(content: streaming.content + content);
                  _notify();
                }
              case AskAiSseCitations(:final citations):
                if (streaming != null) {
                  _streamingMessage = streaming.copyWith(
                    citations: [...?streaming.citations, ...citations],
                  );
                  _notify();
                }
              case AskAiSseDone(content: final doneContent, citations: final doneCitations):
                complete = true;
                if (streaming != null) {
                  _messages = [
                    ..._messages,
                    streaming.copyWith(
                      // RN: `event.content || streamingMessage.content`.
                      content: (doneContent != null && doneContent.isNotEmpty)
                          ? doneContent
                          : streaming.content,
                      citations: doneCitations ?? streaming.citations,
                      isStreaming: false,
                    ),
                  ];
                }
                _streamingMessage = null;
                _subscription?.cancel();
                finish();
              case AskAiSseError(:final error):
                complete = true;
                _streamingMessage = null;
                _error = error;
                _subscription?.cancel();
                finish();
            }
          },
          onError: (Object error) {
            if (complete || _disposed) return;
            complete = true;
            if (error is DioException && error.type == DioExceptionType.cancel) {
              _streamingMessage = null;
              finish();
              return;
            }
            // RN onerror/ontimeout: keep whatever already streamed in, and
            // show the error alongside it rather than in its place.
            _commitPartial();
            _error = error is AskAiChatException
                ? error.message
                : AskAiChatApi.networkErrorMessage;
            finish();
          },
          onDone: () {
            if (complete || _disposed) return;
            complete = true;
            // RN onload without a `done` event: commit what streamed.
            final streaming = _streamingMessage;
            if (streaming != null) {
              _messages = [..._messages, streaming.copyWith(isStreaming: false)];
            }
            _streamingMessage = null;
            finish();
          },
          cancelOnError: true,
        );
  }

  void _commitPartial() {
    final streaming = _streamingMessage;
    if (streaming != null && streaming.content.isNotEmpty) {
      _messages = [..._messages, streaming.copyWith(isStreaming: false)];
    }
    _streamingMessage = null;
  }

  /// Aborts an in-flight stream (RN `cleanup`).
  void cancel() {
    if (_cancelToken == null && _subscription == null) return;
    _cancelToken?.cancel();
    _subscription?.cancel();
    _cancelToken = null;
    _subscription = null;
    _streamingMessage = null;
    _isStreaming = false;
    _notify();
  }

  @override
  void dispose() {
    _cancelToken?.cancel();
    _subscription?.cancel();
    _disposed = true;
    super.dispose();
  }
}
