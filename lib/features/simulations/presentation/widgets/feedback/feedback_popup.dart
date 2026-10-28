import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/localization/localization_controller.dart';
import '../../../../../core/localization/translate_ref.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_fonts.dart';
import '../../../../../core/widgets/app_button.dart';
import 'feedback_widgets.dart';

typedef FeedbackValue = ({int rating, List<String> tags, String comment});

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
  });

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
                  padding: EdgeInsets.fromLTRB(24, 24, 24, 24 + (keyboard > 0 ? 0 : MediaQuery.paddingOf(context).bottom)),
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
                      AppButton(
                        key: const Key('feedback-popup-submit'),
                        label: ref.t('callFeedback.submit'),
                        isDisabled: _rating < 1,
                        onPressed: () => widget.onSubmit((
                          rating: _rating,
                          tags: List.of(_selectedTags),
                          comment: _commentController.text,
                        )),
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
