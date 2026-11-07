import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/widgets/toast/toast_controller.dart';
import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../data/reviews_repository.dart';
import '../data/scribe_reviews_repository.dart';
import 'emoji_keyboard/emoji_keyboard.dart';
import 'review_formatting.dart';
import 'simulation_details_card.dart';

/// Matches ally-mobile (React Native)'s `useShareScreenLogic`'s
/// `MAX_NOTE_LENGTH`.
const _maxNoteLength = 250;

/// Port of ally-mobile (React Native)'s `ShareSimulationScreen`/
/// `ShareCallLogScreen` — a note field + submit, creating a review tied to
/// a completed scenario session (POST /scenario-session-reviews) or scribe
/// call. When [reviewId] is supplied, this is instead the real edit-note
/// flow: a different title/button and a PATCH
/// `updateReviewStatus(status: IN_REVIEW, note)` call rather than a create,
/// matching `useShareScreenLogic`'s `handleEditNote`/`screenTitle`/
/// `buttonLabel` branching exactly.
///
/// The session/scenario context card ([SimulationDetailsCard]: cover
/// image/video, title, description, date/duration rows) is fed by the
/// caller (`ShareSimulationForReviewArgs` for simulations, RN
/// `scenarioData`); missing fields simply drop out. The add-reaction icon
/// opens [EmojiKeyboard], the port of RN's `rn-emoji-keyboard`.
class ShareForReviewScreen extends ConsumerStatefulWidget {
  const ShareForReviewScreen({
    super.key,
    required this.scenarioSessionId,
    this.reviewId,
    this.isEditNote = false,
    this.initialNote,
    this.isScribe = false,
    this.contextTitle,
    this.contextDescription,
    this.contextCoverImageUrl,
    this.contextCoverVideoUrl,
    this.contextDateTime,
    this.contextDuration,
  });

  final String scenarioSessionId;
  final String? reviewId;
  final bool isEditNote;
  final String? initialNote;

  /// Selects the Scribe vs Simulation chip/illustration on the context
  /// card — mirrors which of `ShareSimulationScreen`/`ShareCallLogScreen`
  /// this stands in for.
  final bool isScribe;
  final String? contextTitle;
  final String? contextDescription;
  final String? contextCoverImageUrl;

  /// RN `scenarioData.coverVideoUrl`: plays in the context card.
  final String? contextCoverVideoUrl;

  /// ISO 8601 — rendered via [formatReviewDateTime].
  final String? contextDateTime;

  /// A string of seconds — rendered via [formatReviewDuration].
  final String? contextDuration;

  @override
  ConsumerState<ShareForReviewScreen> createState() =>
      _ShareForReviewScreenState();
}

class _ShareForReviewScreenState extends ConsumerState<ShareForReviewScreen> {
  late final _noteController = TextEditingController(text: widget.initialNote ?? '');
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _noteController.addListener(_onNoteChanged);
  }

  @override
  void dispose() {
    _noteController.removeListener(_onNoteChanged);
    _noteController.dispose();
    super.dispose();
  }

  void _onNoteChanged() => setState(() {});

  /// RN's `handleEmojiSelected`: appended to the end of the note, not
  /// inserted at the cursor — and only while still under the character
  /// limit (a no-op past it, not a truncation).
  void _insertEmoji(String emoji) {
    // RN `Array.from(prev).length < MAX_NOTE_LENGTH` (code points).
    if (_noteController.text.runes.length >= _maxNoteLength) return;
    _noteController.text += emoji;
  }

  /// RN's `useShareScreenLogic`: `handleEditNote` when editing, otherwise
  /// `handleShare` (which updates an existing review's status + note when a
  /// reviewId is known, or creates one). Success toasts and goes back —
  /// except a fresh scribe share, which opens the new review
  /// (`ShareCallLogScreen.onShareSuccess`). Failure toasts the server's
  /// message, falling back to the edit-window copy.
  Future<void> _submit() async {
    if (_isSubmitting) return;
    setState(() => _isSubmitting = true);
    final note = _noteController.text;
    try {
      final reviewId = widget.reviewId;
      if (widget.isScribe) {
        final repository = ref.read(scribeReviewsRepositoryProvider);
        if (reviewId != null) {
          await repository.updateReviewStatus(reviewId: reviewId, status: 'IN_REVIEW', note: note);
        } else {
          final newReviewId = await repository.createReview(
            scribeSessionId: int.parse(widget.scenarioSessionId),
            note: note,
          );
          if (!mounted) return;
          showToast(ref.tr('callFeedback.sharedForReview'));
          context.pushReplacement('/reviews/$newReviewId', extra: ReviewType.scribe);
          return;
        }
      } else {
        final repository = ref.read(reviewsRepositoryProvider);
        if (reviewId != null) {
          await repository.updateReviewStatus(reviewId: reviewId, status: 'IN_REVIEW', note: note);
        } else {
          await repository.createReview(scenarioSessionId: widget.scenarioSessionId, note: note);
        }
      }
      if (!mounted) return;
      showToast(ref.tr(widget.isEditNote ? 'callFeedback.editNoteSuccess' : 'callFeedback.sharedForReview'));
      context.pop();
    } catch (error) {
      if (!mounted) return;
      final serverMessage = error is DioException && error.response?.data is Map
          ? (error.response!.data as Map)['message']?.toString()
          : null;
      showToast(serverMessage ?? ref.tr('callFeedback.issues.editNoteExpired'), type: ToastType.error);
      if (serverMessage != null) context.pop();
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  List<Widget> _detailRows() => [
    if (widget.contextDateTime != null)
      ReviewDetailRow(
        label: ref.t('review.details.dateAndTime'),
        value: formatReviewDateTime(widget.contextDateTime!),
      ),
    if (widget.contextDuration != null)
      ReviewDetailRow(label: ref.t('review.feedCard.duration'), value: formatReviewDuration(widget.contextDuration)),
  ];

  @override
  Widget build(BuildContext context) {
    final screenTitle = widget.isEditNote
        ? ref.t('review.details.editNote')
        : ref.t(widget.isScribe ? 'review.details.shareModalHeader' : 'simulationPage.shareScreenTitle');
    final buttonLabel = widget.isEditNote ? ref.t('common.save') : ref.t('common.share');
    final hasContext =
        widget.contextTitle != null || widget.contextDateTime != null || widget.contextDuration != null;
    final reviewType = widget.isScribe ? ReviewType.scribe : ReviewType.simulation;
    final typeLabel = ref.t('review.feedCard.reviewType', {'reviewType': widget.isScribe ? 'Scribe' : 'Simulation'});
    final insets = MediaQuery.paddingOf(context);

    final children = <Widget>[
      // styles.screenHeader: close icon + IBM Plex Serif Medium headline.tiny.
      Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Row(
          children: [
            GestureDetector(
              key: const Key('share-review-close'),
              onTap: () => context.pop(),
              child: SizedBox(
                width: RnSize.of(context).raw(24),
                height: RnSize.of(context).raw(24),
                child: SvgPicture.asset('assets/icons/close.svg'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(child: Text(screenTitle, style: _titleStyle)),
          ],
        ),
      ),
      // RN's LineTextInput: a borderless multiline field over a 0.5 rule.
      Container(
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
        ),
        child: TextField(
          controller: _noteController,
          minLines: 1,
          maxLines: null,
          inputFormatters: [LengthLimitingTextInputFormatter(_maxNoteLength)],
          style: _inputStyle,
          cursorColor: AppColors.primary,
          decoration: InputDecoration(
            isDense: true,
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            contentPadding: const EdgeInsets.all(12),
            hintText: ref.t('review.addNotePlaceholder'),
            hintStyle: _inputStyle.copyWith(color: AppColors.mediumEmphasis),
          ),
        ),
      ),
      Align(
        alignment: Alignment.centerRight,
        child: Text('${_noteController.text.characters.length}/$_maxNoteLength', style: _lengthStyle),
      ),
      if (hasContext) ...[
        if (!widget.isScribe)
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: _detailRows()),
        SimulationDetailsCard(
          typeLabel: typeLabel,
          reviewType: reviewType,
          title: widget.contextTitle,
          coverImageUrl: widget.isScribe ? null : widget.contextCoverImageUrl,
          coverVideoUrl: widget.isScribe ? null : widget.contextCoverVideoUrl,
          descriptionText: widget.isScribe ? null : htmlToPlainText(widget.contextDescription),
          descriptionWidget: widget.isScribe
              ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: _detailRows())
              : null,
        ),
      ],
      Align(
        alignment: Alignment.centerLeft,
        child: GestureDetector(
          key: const ValueKey('add-emoji-button'),
          // RN ShareReviewLayout's <EmojiKeyboard allowMultipleSelections
          // enableRecentlyUsed enableSearchBar hideHeader>.
          onTap: () => EmojiKeyboard.show(
            context,
            onEmojiSelected: _insertEmoji,
            allowMultipleSelections: true,
            enableRecentlyUsed: true,
            enableSearchBar: true,
            hideHeader: true,
          ),
          child: SizedBox(
            width: RnSize.of(context).raw(24),
            height: RnSize.of(context).raw(24),
            child: SvgPicture.asset('assets/icons/addReaction.svg'),
          ),
        ),
      ),
    ];

    // RN pins the button with `marginTop: 'auto'` inside the scroll
    // content; here it sits under the scroll view, which looks the same
    // whenever the content is shorter than the screen.
    return Scaffold(
      backgroundColor: Colors.white,
      body: Padding(
        padding: EdgeInsets.only(top: insets.top),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final (i, child) in children.indexed) ...[if (i > 0) const SizedBox(height: 16), child],
                  ],
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.only(left: 24, right: 24, top: 16, bottom: 32 + insets.bottom),
              child: AppButton(label: buttonLabel, isLoading: _isSubmitting, onPressed: _submit),
            ),
          ],
        ),
      ),
    );
  }

  static const _titleStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifMedium,
    fontSize: 18,
    height: 24 / 18,
    color: AppColors.highEmphasis,
  );
  static const _inputStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.highEmphasis,
  );
  static const _lengthStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 10,
    height: 14 / 10,
    letterSpacing: 0.3,
    color: AppColors.lowEmphasis,
  );
}
