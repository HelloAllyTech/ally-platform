import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_text_field.dart';
import '../../../core/widgets/emoji_insert_picker.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/reviews_repository.dart';
import '../data/scribe_reviews_repository.dart';
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
/// The session/scenario context card ([SimulationDetailsCard] — cover
/// media, title, description, date/duration rows, same shared widget
/// [ReviewCard] uses) and the emoji-insert picker (RN's
/// `rn-emoji-keyboard`, scoped down — see [EmojiInsertPicker]'s own doc
/// comment) are both wired in, but the context fields are all optional:
/// [contextTitle]/[contextDescription]/[contextCoverImageUrl] aren't
/// available from this app's one real caller today
/// (`SimulationFeedbackScreen` only has the session's own timing, not the
/// scenario's title/description — that would need a separate scenario
/// fetch this screen doesn't have a reason to add yet), so the card
/// degrades to just its Date&time/Duration rows when they're absent,
/// rather than requiring the caller to supply data it doesn't have.
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

  /// ISO 8601 — rendered via [formatReviewDateTime].
  final String? contextDateTime;

  /// A string of seconds — rendered via [formatReviewDuration].
  final String? contextDuration;

  @override
  ConsumerState<ShareForReviewScreen> createState() =>
      _ShareForReviewScreenState();
}

class _ShareForReviewScreenState extends ConsumerState<ShareForReviewScreen> {
  late final _noteController = TextEditingController(
    text: widget.initialNote ?? '',
  );
  bool _isSubmitting = false;
  String? _error;

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
    if (_noteController.text.length >= _maxNoteLength) return;
    _noteController.text += emoji;
  }

  Future<void> _submit() async {
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final note = _noteController.text.trim();
      // RN's `handleShare`: a reviewId (edit mode or otherwise) always
      // updates the existing review's status+note instead of creating a
      // new one — `onCreateReview` only ever fires with neither.
      //
      // Scribe reviews are a genuinely separate backend resource
      // (`/scribe-session-reviews`, confirmed from RN's real
      // `ShareCallLogScreen.tsx` — it calls `createScribeReview`/
      // `updateScribeReviewStatus`, never the simulation-review mutations)
      // — a real, previously-unfixed bug here silently hit the simulation
      // endpoint for scribe sessions too; fixed by branching on
      // `widget.isScribe`.
      if (widget.isScribe) {
        if (widget.reviewId != null) {
          await ref
              .read(scribeReviewsRepositoryProvider)
              .updateReviewStatus(
                reviewId: widget.reviewId!,
                status: 'IN_REVIEW',
                note: note,
              );
          if (mounted) context.pop();
        } else {
          // RN's `ShareCallLogScreen.onShareSuccess`: a fresh create lands
          // on the new review's own details screen (replacing this one),
          // not just "go back" — there's nothing to go back TO showing the
          // share yet.
          final newReviewId = await ref
              .read(scribeReviewsRepositoryProvider)
              .createReview(
                scribeSessionId: int.parse(widget.scenarioSessionId),
                note: note,
              );
          if (mounted) {
            context.pushReplacement('/reviews/$newReviewId', extra: ReviewType.scribe);
          }
        }
      } else if (widget.reviewId != null) {
        await ref
            .read(reviewsRepositoryProvider)
            .updateReviewStatus(
              reviewId: widget.reviewId!,
              status: 'IN_REVIEW',
              note: note,
            );
        if (mounted) context.go('/home');
      } else {
        await ref
            .read(reviewsRepositoryProvider)
            .createReview(
              scenarioSessionId: widget.scenarioSessionId,
              note: note,
            );
        if (mounted) context.go('/home');
      }
    } catch (e) {
      setState(() => _error = '${ref.tr('review.shareFailed')}: $e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final screenTitle = widget.isEditNote
        ? ref.t('review.details.editNote')
        : ref.t('simulationPage.shareScreenTitle');
    final buttonLabel = widget.isEditNote
        ? ref.t('common.save')
        : ref.t('common.share');
    final length = _noteController.text.length;

    final hasContext =
        widget.contextTitle != null ||
        widget.contextDateTime != null ||
        widget.contextDuration != null;
    final reviewType = widget.isScribe ? ReviewType.scribe : ReviewType.simulation;
    final typeLabel = ref.t('review.feedCard.reviewType', {
      'reviewType': widget.isScribe ? 'Scribe' : 'Simulation',
    });

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            TabScreenHeader(title: screenTitle),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (hasContext) ...[
                      if (!widget.isScribe) ...[
                        if (widget.contextDateTime != null)
                          ReviewDetailRow(
                            label: ref.t('review.details.dateAndTime'),
                            value: formatReviewDateTime(widget.contextDateTime!),
                          ),
                        if (widget.contextDuration != null)
                          ReviewDetailRow(
                            label: ref.t('review.feedCard.duration'),
                            value: formatReviewDuration(widget.contextDuration),
                          ),
                        const SizedBox(height: 8),
                      ],
                      SimulationDetailsCard(
                        typeLabel: typeLabel,
                        reviewType: reviewType,
                        title: widget.contextTitle,
                        coverImageUrl: widget.isScribe ? null : widget.contextCoverImageUrl,
                        illustrationAsset: widget.isScribe ? 'assets/icons/scribeReview.svg' : null,
                        descriptionText: widget.isScribe
                            ? null
                            : htmlToPlainText(widget.contextDescription),
                        descriptionWidget: !widget.isScribe
                            ? null
                            : Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  if (widget.contextDateTime != null)
                                    ReviewDetailRow(
                                      label: ref.t('review.details.dateAndTime'),
                                      value: formatReviewDateTime(widget.contextDateTime!),
                                    ),
                                  if (widget.contextDuration != null)
                                    ReviewDetailRow(
                                      label: ref.t('review.feedCard.duration'),
                                      value: formatReviewDuration(widget.contextDuration),
                                    ),
                                ],
                              ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    Text(ref.t('review.addNoteCaption')),
                    const SizedBox(height: 12),
                    AppTextField(
                      controller: _noteController,
                      maxLines: 5,
                      maxLength: _maxNoteLength,
                    ),
                    Row(
                      children: [
                        IconButton(
                          key: const ValueKey('add-emoji-button'),
                          onPressed: () => EmojiInsertPicker.show(context, onEmojiSelected: _insertEmoji),
                          icon: SvgPicture.asset(
                            'assets/icons/smile.svg',
                            width: 24,
                            height: 24,
                          ),
                        ),
                        const Spacer(),
                        Text(
                          '$length/$_maxNoteLength',
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: AppColors.mediumEmphasis),
                        ),
                      ],
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        _error!,
                        style: const TextStyle(color: AppColors.red400),
                      ),
                    ],
                    const SizedBox(height: 16),
                    AppButton(
                      label: buttonLabel,
                      isLoading: _isSubmitting,
                      onPressed: _submit,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
