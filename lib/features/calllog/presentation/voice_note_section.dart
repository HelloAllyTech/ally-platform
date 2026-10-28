import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/settings/settings_repository.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../data/call_log_repository.dart';
import '../data/call_summary_fields.dart';
import '../data/custom_fields_repository.dart';
import '../data/voice_custom_fields.dart';
import 'voice_note_recorder.dart';

String _voiceNoteFieldType(SummaryFieldType type) {
  switch (type) {
    case SummaryFieldType.dropdown:
      return 'select';
    case SummaryFieldType.multilineText:
      return 'multiline';
    case SummaryFieldType.text:
    case SummaryFieldType.inlineText:
      return 'text';
  }
}

/// The built-in half of RN `VoiceNoteSection`'s `voiceFields` memo:
/// editable `summaryFieldDefs`, filtered by the tenant's visible summary
/// fields (`isSummaryFieldVisible`). The custom-field half comes from
/// `voice_custom_fields.dart`, whose `encodeVoiceCustomValue` is RN's
/// per-type encoding of the spoken answers.
List<Map<String, dynamic>> _voiceFieldCatalog(List<String>? visibleFields) => summaryFieldDefs
    .where((field) => field.editable && isSummaryFieldVisible(field, visibleFields))
    .map(
      (field) => {
        'id': field.key,
        'label': field.label,
        'type': _voiceNoteFieldType(field.type),
        if (field.options != null) 'options': field.options,
      },
    )
    .toList();

/// Voice-dictation entry point for a manual scribe note's Call Summary
/// screen — mirrors RN's `VoiceNoteSection`/`VoiceNotePanel`
/// (`src/screens/CallSummaryScreen/components/VoiceNotePanel/`). Records a
/// dictation, sends it to the generate-from-audio endpoint together with the
/// note's built-in field catalog, and applies whatever values the model
/// extracted into the summary form via [onValuesApplied] (which the caller
/// is expected to both merge into its own form state AND persist — see
/// `call_summary_screen.dart`'s `_applyVoiceValues`).
///
/// Only offered for a manual note ([chatId] is always present for one, per
/// RN's own `Boolean(chatId)` check and this screen's `isManualNote` gate at
/// the call site), when the tenant has the voice-note toggle enabled, and
/// for a counsellor.
class VoiceNoteSection extends ConsumerStatefulWidget {
  const VoiceNoteSection({
    super.key,
    required this.chatId,
    required this.onValuesApplied,
    this.onCustomValuesApplied,
  });

  final int chatId;

  /// Called with the extracted built-in field values to merge+persist. Must
  /// rethrow on a persistence failure (not swallow it) — [_handleGenerate]
  /// relies on that to decide whether to close the panel/reset the recorder,
  /// mirroring RN's `handleGenerate`, which only does so once
  /// `applyGeneratedValues` has resolved without throwing.
  final Future<void> Function(Map<String, dynamic> builtinUpdates) onValuesApplied;

  /// RN `onCustomValuesApplied`: dictation upserted custom-field values, so
  /// the caller re-seeds its custom-field form from the server.
  final VoidCallback? onCustomValuesApplied;

  @override
  ConsumerState<VoiceNoteSection> createState() => _VoiceNoteSectionState();
}

class _VoiceNoteSectionState extends ConsumerState<VoiceNoteSection> {
  late final VoiceNoteRecorder _recorder;
  bool _voiceOpen = false;
  bool _isGenerating = false;
  String _transcript = '';

  @override
  void initState() {
    super.initState();
    _recorder = VoiceNoteRecorder()..addListener(_onRecorderChanged);
  }

  void _onRecorderChanged() {
    if (!mounted) return;
    final error = _recorder.error;
    if (error != null) {
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(
          content: Text(
            ref.t(
              error == VoiceRecorderError.permission
                  ? 'calls.createNote.voice.micDenied'
                  : 'calls.createNote.voice.generateError',
            ),
          ),
        ),
      );
      setState(() => _voiceOpen = false);
      unawaited(_recorder.reset());
      return;
    }
    setState(() {});
  }

  @override
  void dispose() {
    _recorder
      ..removeListener(_onRecorderChanged)
      ..dispose();
    super.dispose();
  }

  Future<void> _handleMicPress() async {
    if (_isGenerating) return;
    setState(() => _voiceOpen = true);
    if (_recorder.status == VoiceRecorderStatus.idle) {
      await _recorder.start();
    }
  }

  void _handleDiscard() {
    unawaited(_recorder.reset());
    setState(() => _voiceOpen = false);
  }

  Future<void> _handleGenerate() async {
    final path = _recorder.filePath;
    if (path == null) return;
    setState(() => _isGenerating = true);
    try {
      final builtinFields = _voiceFieldCatalog(ref.read(summaryVisibleFieldsProvider).value);
      final builtinKeys = {for (final f in builtinFields) f['id'] as String};
      final customDefs = {for (final d in _editableCustomFieldDefs()) d.id: d};
      final result = await ref
          .read(callLogRepositoryProvider)
          .generateNoteFromAudio(
            audioFilePath: path,
            fields: [...builtinFields, for (final d in customDefs.values) voiceCustomFieldSpec(d)],
          );

      // RN `applyGeneratedValues`.
      final updates = <String, dynamic>{};
      final customUpdates = <({String fieldDefinitionId, String? value})>[];
      for (final value in result.values) {
        final trimmed = value.value.trim();
        if (trimmed.isEmpty) continue;
        if (builtinKeys.contains(value.id)) {
          updates[value.id] = trimmed;
        } else if (customDefs[value.id] case final def?) {
          final encoded = encodeVoiceCustomValue(def, trimmed);
          if (encoded != null) customUpdates.add((fieldDefinitionId: def.id, value: encoded));
        }
      }
      final filled = updates.length + customUpdates.length;
      if (updates.isNotEmpty) {
        await widget.onValuesApplied(updates);
      }
      if (customUpdates.isNotEmpty) {
        await ref.read(customFieldsRepositoryProvider).upsertValues(widget.chatId, customUpdates);
        widget.onCustomValuesApplied?.call();
      }

      // Best-effort: a transcript-save failure must not fail the generation —
      // the extracted field values (if any) have already been applied.
      final spoken = result.transcript.trim();
      if (spoken.isNotEmpty) {
        _transcript = _transcript.isEmpty ? spoken : '$_transcript\n$spoken';
        try {
          await ref
              .read(callLogRepositoryProvider)
              .saveNoteTranscript(chatId: widget.chatId, transcript: _transcript);
        } catch (_) {
          // Non-fatal.
        }
      }

      await _recorder.reset();
      if (!mounted) return;
      setState(() => _voiceOpen = false);
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(
          content: Text(
            ref.t(
              filled > 0 ? 'calls.createNote.voice.generated' : 'calls.createNote.voice.nothingExtracted',
            ),
          ),
        ),
      );
    } catch (error) {
      // Leaves the recording/panel in place (voiceOpen stays true, the
      // recorder stays 'stopped' with its file intact) so the user can retry
      // Generate without re-recording — mirrors RN's `handleGenerate`, whose
      // reset()/setVoiceOpen(false) calls only run after a successful
      // apply+save, never inside the catch.
      String? message;
      if (error is DioException) {
        final data = error.response?.data;
        if (data is Map) message = data['message'] as String?;
      }
      if (!mounted) return;
      rootScaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(
          content: Text(
            ref.t(
              message == 'NO_SPEECH_DETECTED' ? 'calls.createNote.voice.noSpeech' : 'calls.createNote.voice.generateError',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _isGenerating = false);
    }
  }

  /// The org's custom fields this user may fill by voice — RN skips the
  /// definitions query only when the tenant toggle is explicitly off.
  List<CustomFieldDefinition> _editableCustomFieldDefs() {
    if (ref.read(customFieldsEnabledProvider).value == false) return const [];
    final permissions = ref.read(userPermissionsProvider).value ?? const <String>[];
    final isAdmin = permissions.contains(UserPermissions.manageCustomFieldDefinitions);
    final isCounsellor = permissions.contains(UserPermissions.counselorAccess);
    return [
      for (final def in ref.read(customFieldDefinitionsProvider).value ?? const <CustomFieldDefinition>[])
        if (canVoiceFillCustomField(def, isAdmin: isAdmin, isCounsellor: isCounsellor)) def,
    ];
  }

  @override
  Widget build(BuildContext context) {
    final permissions = ref.watch(userPermissionsProvider).value ?? const <String>[];
    final isCounselor = permissions.contains(UserPermissions.counselorAccess);
    final voiceEnabled = ref.watch(scribeVoiceNoteEnabledProvider).value ?? false;
    final canUseVoice = isCounselor && voiceEnabled;
    if (!canUseVoice) return const SizedBox.shrink();
    // Loaded up front (RN's hooks) so Generate has the custom-field list.
    if (ref.watch(customFieldsEnabledProvider).value != false) ref.watch(customFieldDefinitionsProvider);

    if (!_voiceOpen) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
        child: OutlinedButton.icon(
          key: const Key('voice-note-record-cta'),
          onPressed: _handleMicPress,
          icon: const Icon(Icons.mic, size: 18),
          label: Text(ref.t('calls.createNote.voice.record')),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
      child: _VoiceNotePanel(
        status: _recorder.status,
        durationMs: _recorder.durationMs,
        isGenerating: _isGenerating,
        onPause: () => unawaited(_recorder.pause()),
        onResume: () => unawaited(_recorder.resume()),
        onStop: () => unawaited(_recorder.stop()),
        onGenerate: _handleGenerate,
        onDiscard: _handleDiscard,
      ),
    );
  }
}

String _formatDuration(int ms) {
  final totalSeconds = ms ~/ 1000;
  final minutes = totalSeconds ~/ 60;
  final seconds = totalSeconds % 60;
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}

/// Presentational panel for the recording/generating/ready states — mirrors
/// RN's `VoiceNotePanel.tsx`.
class _VoiceNotePanel extends ConsumerStatefulWidget {
  const _VoiceNotePanel({
    required this.status,
    required this.durationMs,
    required this.isGenerating,
    required this.onPause,
    required this.onResume,
    required this.onStop,
    required this.onGenerate,
    required this.onDiscard,
  });

  final VoiceRecorderStatus status;
  final int durationMs;
  final bool isGenerating;
  final VoidCallback onPause;
  final VoidCallback onResume;
  final VoidCallback onStop;
  final VoidCallback onGenerate;
  final VoidCallback onDiscard;

  @override
  ConsumerState<_VoiceNotePanel> createState() => _VoiceNotePanelState();
}

class _VoiceNotePanelState extends ConsumerState<_VoiceNotePanel> {
  Timer? _messageTimer;
  int _messageIndex = 0;

  List<String> get _generatingMessages => [
    ref.t('calls.createNote.voice.processing.transcribing'),
    ref.t('calls.createNote.voice.processing.extracting'),
    ref.t('calls.createNote.voice.processing.populating'),
  ];

  @override
  void didUpdateWidget(covariant _VoiceNotePanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncMessageTimer();
  }

  @override
  void initState() {
    super.initState();
    _syncMessageTimer();
  }

  void _syncMessageTimer() {
    if (!widget.isGenerating) {
      _messageTimer?.cancel();
      _messageTimer = null;
      _messageIndex = 0;
      return;
    }
    _messageTimer ??= Timer.periodic(const Duration(milliseconds: 2200), (_) {
      if (!mounted) return;
      setState(() => _messageIndex = (_messageIndex + 1) % _generatingMessages.length);
    });
  }

  @override
  void dispose() {
    _messageTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.isGenerating) {
      final messages = _generatingMessages;
      return _panel(
        key: 'voice-note-generating',
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(width: 10),
            Text(messages[_messageIndex % messages.length]),
          ],
        ),
      );
    }

    final isRecording = widget.status == VoiceRecorderStatus.recording;
    final isPaused = widget.status == VoiceRecorderStatus.paused;
    final isStopped = widget.status == VoiceRecorderStatus.stopped;

    if (isRecording || isPaused) {
      return _panel(
        key: 'voice-note-recording',
        child: Row(
          children: [
            Expanded(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.circle, size: 10, color: isPaused ? AppColors.onSurfaceVariant : Colors.red),
                  const SizedBox(width: 10),
                  Flexible(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          ref.t(isRecording ? 'calls.createNote.voice.listening' : 'calls.createNote.voice.paused'),
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          _formatDuration(widget.durationMs),
                          style: const TextStyle(color: AppColors.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (isRecording)
                  TextButton.icon(
                    key: const Key('voice-note-pause'),
                    onPressed: widget.onPause,
                    icon: const Icon(Icons.pause, size: 16),
                    label: Text(ref.t('calls.createNote.voice.pause')),
                  )
                else
                  TextButton.icon(
                    key: const Key('voice-note-resume'),
                    onPressed: widget.onResume,
                    icon: const Icon(Icons.play_arrow, size: 16),
                    label: Text(ref.t('calls.createNote.voice.resume')),
                  ),
                TextButton.icon(
                  key: const Key('voice-note-stop'),
                  onPressed: widget.onStop,
                  icon: const Icon(Icons.stop, size: 16, color: Colors.red),
                  label: Text(ref.t('calls.createNote.voice.stop'), style: const TextStyle(color: Colors.red)),
                ),
              ],
            ),
          ],
        ),
      );
    }

    if (isStopped) {
      return _panel(
        key: 'voice-note-ready',
        child: Row(
          children: [
            Expanded(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.mic, size: 18),
                  const SizedBox(width: 10),
                  Flexible(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(ref.t('calls.createNote.voice.ready'), overflow: TextOverflow.ellipsis),
                        Text(
                          _formatDuration(widget.durationMs),
                          style: const TextStyle(color: AppColors.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextButton.icon(
                  key: const Key('voice-note-discard'),
                  onPressed: widget.onDiscard,
                  icon: const Icon(Icons.delete_outline, size: 16),
                  label: Text(ref.t('calls.createNote.voice.discard')),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('voice-note-generate'),
                  onPressed: widget.onGenerate,
                  child: Text(ref.t('calls.createNote.voice.generate')),
                ),
              ],
            ),
          ],
        ),
      );
    }

    return const SizedBox.shrink();
  }

  Widget _panel({required String key, required Widget child}) {
    return Container(
      key: Key(key),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.strokePrimary),
        borderRadius: BorderRadius.circular(8),
      ),
      child: child,
    );
  }
}
