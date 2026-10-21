import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/widgets/app_button.dart';
import '../../../../core/widgets/app_card.dart';
import '../../../../core/widgets/app_text_field.dart';
import '../../data/course_models.dart';
import '../../data/courses_repository.dart';
import '../../data/start_item_payload.dart';

/// Port of ally-mobile (React Native)'s `JournalPlayer` — one card per
/// prompt with a debounced draft autosave and a Submit that completes the
/// item once every required prompt is answered. Mirrors ally-web's
/// `JournalItemPlayer`.
class JournalPlayer extends ConsumerStatefulWidget {
  const JournalPlayer({
    super.key,
    required this.payload,
    required this.itemId,
    required this.alreadyCompleted,
    required this.onCompleted,
  });

  final StartItemPayload payload;
  final String itemId;
  final bool alreadyCompleted;
  final void Function(TrackItemCompletionResult result) onCompleted;

  @override
  ConsumerState<JournalPlayer> createState() => _JournalPlayerState();
}

enum _AutosaveStatus { saved, saving, failed }

class _JournalPlayerState extends ConsumerState<JournalPlayer> {
  static const _autosaveDelay = Duration(seconds: 1);

  late final Map<String, TextEditingController> _controllers;
  Timer? _debounce;
  _AutosaveStatus _autosaveStatus = _AutosaveStatus.saved;
  bool _submitted = false;
  bool _submitting = false;

  List<JournalPrompt> get _prompts => widget.payload.journalPrompts ?? [];

  @override
  void initState() {
    super.initState();
    _submitted = widget.alreadyCompleted;
    final saved = widget.payload.journalSavedResponses ?? [];
    _controllers = {
      for (final prompt in _prompts)
        prompt.id: TextEditingController(
          text:
              saved
                  .where((r) => r.promptId == prompt.id)
                  .firstOrNull
                  ?.response ??
              '',
        ),
    };
  }

  @override
  void dispose() {
    _debounce?.cancel();
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  bool get _allRequiredAnswered => _prompts.every(
    (p) => !p.required || _controllers[p.id]!.text.trim().isNotEmpty,
  );

  void _onChanged(String _) {
    if (_submitted) return;
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(_autosaveDelay, _persist);
  }

  Future<void> _persist() async {
    setState(() => _autosaveStatus = _AutosaveStatus.saving);
    try {
      await ref
          .read(coursesRepositoryProvider)
          .saveJournalDraft(
            itemId: widget.itemId,
            responses: [
              for (final prompt in _prompts)
                (promptId: prompt.id, response: _controllers[prompt.id]!.text),
            ],
          );
      if (mounted) setState(() => _autosaveStatus = _AutosaveStatus.saved);
    } catch (_) {
      if (mounted) setState(() => _autosaveStatus = _AutosaveStatus.failed);
    }
  }

  Future<void> _submit() async {
    if (!_allRequiredAnswered || _submitting || _submitted) return;
    setState(() => _submitting = true);
    try {
      _debounce?.cancel();
      await _persist();
      final result = await ref
          .read(coursesRepositoryProvider)
          .submitJournal(widget.itemId);
      setState(() {
        _submitted = true;
        _submitting = false;
      });
      widget.onCompleted(result);
    } catch (_) {
      // Submit stays available so the learner can retry, same as the RN
      // screen.
      if (mounted) setState(() => _submitting = false);
    }
  }

  String get _autosaveLabel {
    if (_submitted) return ref.t('courses.journal.submitted');
    switch (_autosaveStatus) {
      case _AutosaveStatus.saving:
        return ref.t('courses.journal.saving');
      case _AutosaveStatus.failed:
        return ref.t('courses.journal.saveFailed');
      case _AutosaveStatus.saved:
        return ref.t('courses.journal.saved');
    }
  }

  Color _autosaveColor(BuildContext context) {
    if (_submitted) return Colors.green;
    if (_autosaveStatus == _AutosaveStatus.failed) return Colors.red;
    return Theme.of(context).textTheme.bodySmall?.color ?? Colors.grey;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: Text(
                  _autosaveLabel,
                  style: TextStyle(
                    color: _autosaveColor(context),
                    fontSize: 12,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              for (var i = 0; i < _prompts.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: AppCard(
                    variant: AppCardVariant.flat,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              CircleAvatar(radius: 14, child: Text('${i + 1}')),
                              const SizedBox(width: 10),
                              Expanded(
                                child: RichText(
                                  text: TextSpan(
                                    style: DefaultTextStyle.of(context).style,
                                    children: [
                                      TextSpan(text: _prompts[i].prompt),
                                      if (_prompts[i].required)
                                        TextSpan(
                                          text:
                                              ' (${ref.t('courses.journal.required')})',
                                          style: const TextStyle(
                                            color: Colors.red,
                                            fontSize: 12,
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _controllers[_prompts[i].id],
                            onChanged: _onChanged,
                            maxLines: 4,
                            enabled: !_submitted,
                            style: AppTextField.textStyleFor(context),
                            decoration: AppTextField.decorationFor(
                              context,
                              placeholder:
                                  _prompts[i].placeholder ??
                                  ref.t('courses.journal.placeholder'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: _submitted
                ? Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      SvgPicture.asset(
                        'assets/icons/checkCircle.svg',
                        width: 24,
                        height: 24,
                      ),
                      const SizedBox(width: 8),
                      Text(ref.t('courses.journal.submitted')),
                    ],
                  )
                : AppButton(
                    label: ref.t('courses.journal.submit'),
                    isDisabled: !_allRequiredAnswered,
                    isLoading: _submitting,
                    onPressed: _allRequiredAnswered ? _submit : null,
                  ),
          ),
        ),
      ],
    );
  }
}
