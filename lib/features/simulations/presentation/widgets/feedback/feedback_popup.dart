import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/localization/localization_controller.dart';
import '../../../../../core/localization/translate_ref.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_fonts.dart';
import '../../../../../core/widgets/app_button.dart';
import 'feedback_widgets.dart';

typedef FeedbackValue = ({int rating, List<String> tags, String comment});

/// RN `constants/feedback.ts` `FEEDBACK_ISSUE_OPTIONS` (value, label key);
/// `OTHER` must stay last — it is the one that opens the comment box.
const feedbackIssueOptions = <(String, String)>[
  ('MISSING_KEY_INFORMATION', 'callFeedback.issues.missingKeyInfo'),
  ('INACCURATE', 'callFeedback.issues.inaccurate'),
  ('TOO_VAGUE', 'callFeedback.issues.tooVague'),
  ('DIFFICULT_TO_UNDERSTAND', 'callFeedback.issues.difficultToUnderstand'),
  ('TOO_SHORT', 'callFeedback.issues.tooShort'),
  ('OTHER', 'callFeedback.issues.other'),
];

/// Port of RN `components/FeedbackPopup` as `SimulationFeedbackScreen` uses
/// it (`showChips={false}`, a custom title and placeholder): a dimmed
/// backdrop (tap = close) and a bottom sheet that springs up with the
/// title, five 30pt stars, the rating's caption (`callFeedback.ratings.N`),
/// that rating's tag chips (`postSim.feedback.dialog.rating.tags.N`), a
/// comment box, and Submit (disabled until a star is picked). Picking a new
/// rating clears the chosen tags, as RN's `setStarRating` does.
class FeedbackPopup extends ConsumerStatefulWidget {
  const FeedbackPopup({
    super.key,
    required this.onClose,
    required this.onSubmit,
    required this.title,
    required this.placeholder,
    this.initialFeedback,
    this.showChips = false,
    this.note,
    this.onSubmitWithIssues,
  });

  /// RN `showChips` (default true there; Simulation feedback passes false).
  /// With it, a 1-4 star rating shows the "select issues" chips and the
  /// comment box only appears for 5 stars or once "Other" is picked.
  final bool showChips;

  /// RN `note`: centered text above Submit (Call Summary's
  /// `callFeedback.rateSubtitle`).
  final String? note;

  /// Used instead of [onSubmit] when given: also carries the picked issue
  /// values (RN's `issues`).
  final void Function(FeedbackValue value, List<String> issues)? onSubmitWithIssues;

  final VoidCallback onClose;
  final ValueChanged<FeedbackValue> onSubmit;
  final String title;
  final String placeholder;
  final FeedbackValue? initialFeedback;

  @override
  ConsumerState<FeedbackPopup> createState() => _FeedbackPopupState();
}

class _FeedbackPopupState extends ConsumerState<FeedbackPopup> {
  late int _rating = widget.initialFeedback?.rating ?? 0;
  late final _selectedTags = <String>[...?widget.initialFeedback?.tags];
  final _selectedIssues = <String>[];
  late final _commentController = TextEditingController(text: widget.initialFeedback?.comment ?? '');

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tags = _rating <= 0
        ? const <String>[]
        : ((ref.watch(localizationControllerProvider).value?.raw('postSim.feedback.dialog.rating.tags.$_rating')
                      as List<dynamic>?) ??
                  const [])
              .cast<String>();
    final ratingText = _rating < 1 ? '' : ref.t('callFeedback.ratings.$_rating');
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;

    return Stack(
      children: [
        Positioned.fill(
          child: GestureDetector(
            key: const Key('feedback-popup-backdrop'),
            onTap: widget.onClose,
            child: const ColoredBox(color: Color(0x80000000)),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: keyboard,
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 1, end: 0),
            duration: const Duration(milliseconds: 350),
            curve: Curves.easeOutBack,
            builder: (context, t, child) => FractionalTranslation(translation: Offset(0, t), child: child),
            child: ConstrainedBox(
              constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.9),
              child: Material(
                color: Colors.white,
                elevation: 10,
                shadowColor: Colors.black.withValues(alpha: 0.25),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(
                    24,
                    24,
                    24,
                    24 + (keyboard > 0 ? 0 : MediaQuery.paddingOf(context).bottom),
                  ),
                  child: Column(
                    key: const Key('feedback-popup'),
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(
                          widget.title,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontFamily: AppFonts.ibmPlexSerifMedium,
                            fontSize: 16,
                            height: 24 / 16,
                            letterSpacing: 0.5,
                            color: AppColors.highEmphasis,
                          ),
                        ),
                      ),
                      StarRatingRow(
                        rating: _rating,
                        onChanged: (value) => setState(() {
                          _rating = value;
                          _selectedTags.clear();
                          _selectedIssues.clear();
                        }),
                      ),
                      if (ratingText.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 4, bottom: 14),
                          child: Text(
                            ratingText,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontFamily: AppFonts.ibmPlexSerifRegular,
                              fontSize: 14,
                              color: Colors.black,
                            ),
                          ),
                        ),
                      if (tags.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 14),
                          child: Wrap(
                            alignment: WrapAlignment.center,
                            spacing: 8,
                            runSpacing: 8,
                            children: [for (final tag in tags) _tag(tag)],
                          ),
                        ),
                      if (widget.showChips && _rating != 5 && _rating != 0) ..._issueChips(),
                      if (_showSuggestionPrompt)
                        Padding(
                          padding: const EdgeInsets.only(top: 4, bottom: 12),
                          child: Text(
                            ref.t('callFeedback.moreSuggestions'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontFamily: AppFonts.ibmPlexSerifRegular,
                              fontSize: 12,
                              color: AppColors.darkGray12,
                            ),
                          ),
                        ),
                      if (_showComment)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 16),
                          child: TextField(
                            key: const Key('feedback-popup-comment'),
                            controller: _commentController,
                            minLines: 4,
                            maxLines: null,
                            style: const TextStyle(
                              fontFamily: AppFonts.ibmPlexSerifRegular,
                              fontSize: 14,
                              height: 22 / 14,
                              letterSpacing: 0.2,
                              color: Colors.black,
                            ),
                            decoration: InputDecoration(
                              hintText: widget.placeholder,
                              hintStyle: const TextStyle(
                                fontFamily: AppFonts.ibmPlexSerifRegular,
                                fontSize: 14,
                                color: AppColors.lowEmphasis,
                              ),
                              isDense: true,
                              contentPadding: const EdgeInsets.all(12),
                              filled: true,
                              fillColor: Colors.white,
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide: const BorderSide(color: AppColors.strokePrimary, width: 0.5),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide: const BorderSide(color: AppColors.strokePrimary, width: 0.5),
                              ),
                            ),
                          ),
                        ),
                      if (widget.note != null && widget.note!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 24),
                          child: Text(
                            widget.note!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontFamily: AppFonts.ibmPlexSerifRegular,
                              fontSize: 14,
                              height: 18 / 14,
                              letterSpacing: 0.2,
                              color: AppColors.highEmphasis,
                            ),
                          ),
                        ),
                      AppButton(
                        key: const Key('feedback-popup-submit'),
                        label: ref.t('callFeedback.submit'),
                        isDisabled: _rating < 1,
                        onPressed: () {
                          final value = (
                            rating: _rating,
                            tags: List.of(_selectedTags),
                            comment: _commentController.text,
                          );
                          final withIssues = widget.onSubmitWithIssues;
                          if (withIssues != null) {
                            withIssues(value, List.of(_selectedIssues));
                          } else {
                            widget.onSubmit(value);
                          }
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// RN: the comment box shows for 5 stars, without chips, or with "Other"
  /// picked; its "more suggestions" prompt only while no issue is picked
  /// and the caller gave no placeholder of its own.
  bool get _showComment => _rating == 5 || !widget.showChips || _selectedIssues.contains(feedbackIssueOptions.last.$1);
  bool get _showSuggestionPrompt => widget.showChips && _showComment && _selectedIssues.isEmpty;

  /// RN `ChipGroup` (title `callFeedback.selectIssues`, Medium 16 black)
  /// of `Chip`s (lightGray4 outline, lightGray3 IBM Plex Serif 14; selected
  /// = azureBlue fill, white 500) and the lowEmphasis separator under it.
  List<Widget> _issueChips() {
    return [
      Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Text(
          ref.t('callFeedback.selectIssues'),
          textAlign: TextAlign.center,
          style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 16, color: Colors.black),
        ),
      ),
      Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Wrap(
          alignment: WrapAlignment.center,
          children: [
            for (final (value, labelKey) in feedbackIssueOptions)
              GestureDetector(
                key: ValueKey('feedback-issue-$value'),
                onTap: () => setState(
                  () => _selectedIssues.contains(value) ? _selectedIssues.remove(value) : _selectedIssues.add(value),
                ),
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(
                    color: _selectedIssues.contains(value) ? AppColors.azureBlue : Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: _selectedIssues.contains(value) ? AppColors.azureBlue : AppColors.lightGray4,
                    ),
                  ),
                  child: Text(
                    ref.t(labelKey),
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 14,
                      color: _selectedIssues.contains(value) ? Colors.white : AppColors.lightGray3,
                      fontWeight: _selectedIssues.contains(value) ? FontWeight.w500 : FontWeight.w400,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
      Container(height: 1, margin: const EdgeInsets.only(bottom: 16), color: AppColors.lowEmphasis),
    ];
  }

  Widget _tag(String tag) {
    final selected = _selectedTags.contains(tag);
    return GestureDetector(
      onTap: () => setState(() => selected ? _selectedTags.remove(tag) : _selectedTags.add(tag)),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: selected ? AppColors.primary : AppColors.strokePrimary),
        ),
        child: Text(
          tag,
          style: TextStyle(
            fontFamily: AppFonts.ibmPlexSerifRegular,
            fontSize: 13,
            color: selected ? Colors.white : AppColors.highEmphasis,
          ),
        ),
      ),
    );
  }
}
