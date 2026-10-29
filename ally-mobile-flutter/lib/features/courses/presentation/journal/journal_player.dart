import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/html_rich_text.dart';
import '../../data/course_models.dart';
import '../../data/courses_repository.dart';
import '../../data/start_item_payload.dart';
import '../course_button.dart';
import '../course_styles.dart';

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

  /// RN autosaveDefault / autosaveSubmitted / autosaveFailed.
  Color get _autosaveColor {
    if (_submitted) return AppColors.green700;
    if (_autosaveStatus == _AutosaveStatus.failed) return AppColors.red400;
    return AppColors.lowEmphasis;
  }

  @override
  Widget build(BuildContext context) {
    final inputStyle = CourseType.bodyMedium.copyWith(fontFamily: courseSystemFont, color: AppColors.highEmphasis);
    final inputBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: const BorderSide(color: AppColors.strokePrimary),
    );
    final requiredTag = CourseType.bodyTiny.copyWith(fontFamily: courseSystemFont, color: AppColors.red400);
    return Column(
      children: [
        Expanded(
          // styles.scrollContent: padding 16, gap 16; each card adds its
          // own marginBottom 16.
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: Text(
                  _autosaveLabel,
                  key: const Key('journal-autosave-status'),
                  style: CourseType.bodyTiny.copyWith(fontFamily: courseSystemFont, color: _autosaveColor),
                ),
              ),
              for (var i = 0; i < _prompts.length; i++)
                Container(
                  key: Key('journal-card-${_prompts[i].id}'),
                  margin: const EdgeInsets.only(top: 16, bottom: 16),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: AppColors.strokePrimary),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 28,
                            height: 28,
                            alignment: Alignment.center,
                            decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
                            child: Text(
                              '${i + 1}',
                              style: CourseText.serifMedium(CourseType.bodySmall, Colors.white, weight: FontWeight.w500),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: (_prompts[i].promptHtml ?? '').isNotEmpty
                                ? Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      HtmlRichText(html: _prompts[i].promptHtml),
                                      if (_prompts[i].required)
                                        Text('(${ref.t('courses.journal.required')})', style: requiredTag),
                                    ],
                                  )
                                : Text.rich(
                                    TextSpan(
                                      style: CourseText.serif(
                                        CourseType.bodyMedium,
                                        AppColors.highEmphasis,
                                        weight: FontWeight.w500,
                                      ),
                                      children: [
                                        TextSpan(text: _prompts[i].prompt),
                                        if (_prompts[i].required)
                                          TextSpan(
                                            text: ' (${ref.t('courses.journal.required')})',
                                            style: requiredTag.copyWith(fontWeight: FontWeight.w400),
                                          ),
                                      ],
                                    ),
                                  ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      ConstrainedBox(
                        constraints: const BoxConstraints(minHeight: 96),
                        child: TextField(
                          key: Key('journal-response-${_prompts[i].id}'),
                          controller: _controllers[_prompts[i].id],
                          onChanged: _onChanged,
                          minLines: 4,
                          maxLines: null,
                          keyboardType: TextInputType.multiline,
                          enabled: !_submitted,
                          style: inputStyle,
                          cursorColor: AppColors.primary,
                          decoration: InputDecoration(
                            isDense: true,
                            hintText: _prompts[i].placeholder ?? ref.t('courses.journal.placeholder'),
                            hintStyle: inputStyle.copyWith(color: AppColors.iosPlaceholder),
                            contentPadding: const EdgeInsets.all(10),
                            border: inputBorder,
                            enabledBorder: inputBorder,
                            focusedBorder: inputBorder,
                            disabledBorder: inputBorder,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        // styles.footer: borderTop 0.5, padding 16, centred.
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
          ),
          child: _submitted
              ? Row(
                  key: const Key('journal-submitted-chip'),
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SvgPicture.asset('assets/icons/tickRound.svg', width: 16, height: 16),
                    const SizedBox(width: 6),
                    Text(
                      ref.t('courses.journal.submitted'),
                      style: const TextStyle(fontFamily: courseSystemFont, fontSize: 14, color: AppColors.green700),
                    ),
                  ],
                )
              : CourseButton(
                  key: const Key('journal-submit'),
                  label: ref.t('courses.journal.submit'),
                  isDisabled: !_allRequiredAnswered,
                  isLoading: _submitting,
                  onPressed: _submit,
                ),
        ),
      ],
    );
  }
}
