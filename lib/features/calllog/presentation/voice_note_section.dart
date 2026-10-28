import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/cupertino.dart' show CupertinoActivityIndicator;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/settings/settings_repository.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../data/call_log_repository.dart';
import '../data/call_summary_fields.dart';
import '../data/custom_fields_repository.dart';
import '../data/voice_custom_fields.dart';
import 'voice_note_recorder.dart';

String _voiceNoteFieldType(SummaryFieldType type) {
  switch (type) {
    // RN `mapBuiltinType`: Dropdown and SearchableDropdown are both 'select'.
    case SummaryFieldType.dropdown:
    case SummaryFieldType.searchableDropdown:
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
    this.existingTranscript,
  });

  final int chatId;

  /// RN `summaryData.details.transcript`: the note's previously saved
  /// dictation, which seeds the accumulated transcript so re-dictating on a
  /// later visit appends to it instead of replacing it.
  final String? existingTranscript;

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
  /// RN `transcriptRef`: accumulates the dictation transcript across
  /// recordings; the full text is re-sent on every save (the endpoint
  /// replaces the stored transcript).
  String _transcript = '';

  @override
  void initState() {
    super.initState();
    _recorder = VoiceNoteRecorder()..addListener(_onRecorderChanged);
    _seedTranscript();
  }

  @override
  void didUpdateWidget(covariant VoiceNoteSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    _seedTranscript();
  }

  /// RN's seed effect: `if (existingTranscript && !transcriptRef.current)`.
  void _seedTranscript() {
    final existing = widget.existingTranscript;
    if (existing != null && existing.isNotEmpty && _transcript.isEmpty) _transcript = existing;
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
      // RN `styles.recordCta`: azureBlue-outlined row, MicIcon 18 + label.
      return GestureDetector(
        key: const Key('voice-note-record-cta'),
        behavior: HitTestBehavior.opaque,
        onTap: _handleMicPress,
        child: Container(
          margin: EdgeInsets.only(left: RnSize.of(context).s(16), right: RnSize.of(context).s(16), top: 10),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.azureBlue),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SvgPicture.asset('assets/icons/mic.svg', width: 18, height: 18),
              const SizedBox(width: 6),
              Text(ref.t('calls.createNote.voice.record'), style: _bodySmall.copyWith(color: AppColors.azureBlue)),
            ],
          ),
        ),
      );
    }

    return Padding(
      padding: EdgeInsets.only(left: RnSize.of(context).s(16), right: RnSize.of(context).s(16), top: 10),
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
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const CupertinoActivityIndicator(color: AppColors.azureBlue),
                  const SizedBox(width: 10),
                  Flexible(child: Text(messages[_messageIndex % messages.length], style: _statusText)),
                ],
              ),
            ),
          ),
        ],
      );
    }

    final isRecording = widget.status == VoiceRecorderStatus.recording;
    final isPaused = widget.status == VoiceRecorderStatus.paused;
    final isStopped = widget.status == VoiceRecorderStatus.stopped;

    if (isRecording || isPaused) {
      return _panel(
        key: 'voice-note-recording',
        children: [
          Flexible(
            child: _statusBlock(
              leading: Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: isPaused ? AppColors.ashGray : AppColors.red400,
                  borderRadius: BorderRadius.circular(5),
                ),
              ),
              label: ref.t(isRecording ? 'calls.createNote.voice.listening' : 'calls.createNote.voice.paused'),
            ),
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (isRecording)
                _ctrlButton(
                  key: 'voice-note-pause',
                  onTap: widget.onPause,
                  icon: SvgPicture.asset('assets/icons/pause.svg', width: 16, height: 16),
                  label: ref.t('calls.createNote.voice.pause'),
                )
              else
                _ctrlButton(
                  key: 'voice-note-resume',
                  onTap: widget.onResume,
                  icon: SvgPicture.asset('assets/icons/play.svg', width: 16, height: 16),
                  label: ref.t('calls.createNote.voice.resume'),
                ),
              const SizedBox(width: 8),
              // RN `stopButton` + `stopSquare`: a red-outlined button with a
              // 10pt rounded red square, not an icon.
              _ctrlButton(
                key: 'voice-note-stop',
                onTap: widget.onStop,
                borderColor: AppColors.red400,
                icon: Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(color: AppColors.red400, borderRadius: BorderRadius.circular(2)),
                ),
                label: ref.t('calls.createNote.voice.stop'),
                textColor: AppColors.red400,
              ),
            ],
          ),
        ],
      );
    }

    if (isStopped) {
      return _panel(
        key: 'voice-note-ready',
        children: [
          Flexible(
            child: _statusBlock(
              leading: SvgPicture.asset('assets/icons/mic.svg', width: 18, height: 18),
              label: ref.t('calls.createNote.voice.ready'),
            ),
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _ctrlButton(
                key: 'voice-note-discard',
                onTap: widget.onDiscard,
                icon: SvgPicture.asset('assets/icons/delete.svg', width: 16, height: 16),
                label: ref.t('calls.createNote.voice.discard'),
              ),
              const SizedBox(width: 8),
              _ctrlButton(
                key: 'voice-note-generate',
                onTap: widget.onGenerate,
                label: ref.t('calls.createNote.voice.generate'),
                textColor: Colors.white,
                borderColor: AppColors.azureBlue,
                background: AppColors.azureBlue,
              ),
            ],
          ),
        ],
      );
    }

    return const SizedBox.shrink();
  }

  /// RN `statusBlock` + `statusTextBlock`: leading dot/icon, status line
  /// and the elapsed time under it.
  Widget _statusBlock({required Widget leading, required String label}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        leading,
        const SizedBox(width: 10),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label, style: _statusText),
              Text(_formatDuration(widget.durationMs), style: _bodySmall.copyWith(color: AppColors.ashGray)),
            ],
          ),
        ),
      ],
    );
  }

  /// RN `styles.ctrlButton`: 1pt ashGray border, radius 6, padding 10×6,
  /// 4pt gap between icon and label.
  Widget _ctrlButton({
    required String key,
    required VoidCallback onTap,
    required String label,
    Widget? icon,
    Color borderColor = AppColors.ashGray,
    Color textColor = AppColors.darkSlate,
    Color? background,
  }) {
    return GestureDetector(
      key: Key(key),
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: background,
          border: Border.all(color: borderColor),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[icon, const SizedBox(width: 4)],
            Text(label, style: _bodySmall.copyWith(color: textColor)),
          ],
        ),
      ),
    );
  }

  /// RN `styles.panel`: lightGray5 border, white, radius 8, padding 12,
  /// children spread apart.
  Widget _panel({required String key, required List<Widget> children}) {
    return Container(
      key: Key(key),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.lightGray5),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: children),
    );
  }
}

/// RN `typography.body.small` with no fontFamily — the iOS system font.
const _bodySmall = TextStyle(fontFamily: 'CupertinoSystemText', fontSize: 12, height: 16 / 12, letterSpacing: 0.2);
final _statusText = _bodySmall.copyWith(color: AppColors.darkSlate);
