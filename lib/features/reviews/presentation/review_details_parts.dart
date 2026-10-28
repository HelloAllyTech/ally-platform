import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/confirmation_modal.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../account/data/user_profile.dart';
import '../../simulations/presentation/simulation_info_modal.dart';
import '../data/review_models.dart';
import 'comment_list_controller.dart';
import 'review_formatting.dart';
import 'review_styles.dart';
import 'review_widgets.dart';

/// Port of RN's `ReviewTranscriptDetails/ReviewTranscriptHeader`: type chip,
/// one-line title and (simulation) a help icon opening the scenario's
/// details, an optional "Share" switch (scribe reviews put it here), then a
/// sideways-scrolling "avatar By name • date • Duration: x" line.
class ReviewTranscriptHeader extends ConsumerWidget {
  const ReviewTranscriptHeader({
    super.key,
    required this.reviewType,
    required this.title,
    required this.user,
    this.createdAt,
    this.duration,
    this.scenario,
    this.isPrivate = false,
    this.onTogglePrivate,
  });

  final ReviewType reviewType;
  final String title;
  final ReviewAuthor user;
  final String? createdAt;
  final String? duration;
  final ReviewScenario? scenario;
  final bool isPrivate;
  final ValueChanged<bool>? onTogglePrivate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    final subtitle = ReviewText.serif(RnType.bodySmall, AppColors.mediumEmphasis);
    Widget bullet() => Padding(
      padding: EdgeInsets.symmetric(horizontal: rn.s(4)),
      child: Text('•', style: ReviewText.serifMedium(RnType.bodyMedium, AppColors.mediumEmphasis)),
    );
    final hasDuration = duration != null && duration!.isNotEmpty && duration != '0';

    return Padding(
      padding: EdgeInsets.symmetric(horizontal: rn.s(8)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Flexible(
                child: Row(
                  children: [
                    Flexible(
                      child: ReviewTypeChip(
                        reviewType: reviewType,
                        label: ref.t('review.feedCard.reviewType', {
                          'reviewType': reviewType == ReviewType.scribe ? 'Scribe' : 'Simulation',
                        }),
                      ),
                    ),
                    SizedBox(width: rn.s(8)),
                    Flexible(
                      child: Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: ReviewText.style(
                          RnType.bodyMedium,
                          AppFonts.ibmPlexSerifMedium,
                          AppColors.highEmphasis,
                          weight: FontWeight.w500,
                        ),
                      ),
                    ),
                    if (scenario != null) ...[
                      SizedBox(width: rn.s(8)),
                      GestureDetector(
                        key: const Key('review-header-help'),
                        // RN SimulationDetailsModal (fitContent, read-only).
                        onTap: () => SimulationInfoModal.show(
                          context,
                          headerTitle: scenario!.title,
                          title: ref.tr('simulationPage.simulationDetails'),
                          description: htmlToPlainText(scenario!.description),
                          coverImageUrl: scenario!.coverImageUrl,
                          coverVideoUrl: scenario!.coverVideoUrl,
                        ),
                        child: SvgPicture.asset('assets/icons/help.svg', width: 14, height: 14),
                      ),
                    ],
                  ],
                ),
              ),
              if (onTogglePrivate != null) ...[
                const SizedBox(width: 8),
                Text(ref.t('learn.scenario.share'), style: ReviewText.serif(RnType.bodySmall, AppColors.lowEmphasis)),
                const SizedBox(width: 8),
                ReviewSwitch(value: !isPrivate, onToggle: onTogglePrivate!),
              ],
            ],
          ),
          SizedBox(height: rn.s(4)),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                ReviewUserAvatar(name: user.name, imageUrl: user.profileImage, size: 16, textStyle: RnType.bodyMicro),
                SizedBox(width: rn.s(4)),
                if (user.name.isNotEmpty) Text(ref.t('review.byAuthor', {'name': user.name}), style: subtitle),
                if (createdAt != null && createdAt!.isNotEmpty) ...[
                  SizedBox(width: rn.s(4)),
                  bullet(),
                  SizedBox(width: rn.s(4)),
                  Text(formatReviewDateTime(createdAt!), style: subtitle),
                ],
                if (hasDuration) ...[
                  SizedBox(width: rn.s(4)),
                  bullet(),
                  SizedBox(width: rn.s(4)),
                  Text('${ref.t('common.duration')}: ${formatReviewDuration(duration)}', style: subtitle),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Port of RN's `ReviewDetailsScreen/components/GeneralCommentsSection`,
/// the transcript's footer: "Comments", the signed-in user's avatar + an
/// "Add a comment" input, then (once the review has a general thread) its
/// comments — Reply opens the reply sheet, Edit swaps the comment for an
/// inline input — and "Load More".
class GeneralCommentsSection extends ConsumerStatefulWidget {
  const GeneralCommentsSection({
    super.key,
    required this.controller,
    required this.currentUser,
    required this.isPrivate,
    required this.reviewOwnerId,
    required this.hasGeneralThread,
    required this.onReplyPress,
  });

  final CommentListController controller;
  final UserProfile? currentUser;
  final bool isPrivate;
  final int? reviewOwnerId;
  final bool hasGeneralThread;
  final ValueChanged<ThreadComment> onReplyPress;

  @override
  ConsumerState<GeneralCommentsSection> createState() => _GeneralCommentsSectionState();
}

class _GeneralCommentsSectionState extends ConsumerState<GeneralCommentsSection> {
  final _input = TextEditingController();
  final _editInput = TextEditingController();

  static final _inputStyle = ReviewText.raw(AppFonts.ibmPlexSerifRegular, 14, 20, AppColors.highEmphasis, letterSpacing: 0.25);

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_rebuild);
    _input.addListener(_rebuild);
    _editInput.addListener(_rebuild);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_rebuild);
    _input.dispose();
    _editInput.dispose();
    super.dispose();
  }

  void _rebuild() {
    if (mounted) setState(() {});
  }

  Future<void> _submit() async {
    final text = _input.text;
    if (text.trim().isEmpty) return;
    if (widget.controller.editingCommentId != null) widget.controller.cancelEdit();
    _input.clear();
    FocusScope.of(context).unfocus();
    await widget.controller.submit(text);
  }

  Future<void> _submitEdit() async {
    final text = _editInput.text;
    if (text.trim().isEmpty) return;
    await widget.controller.submit(text);
  }

  Future<void> _delete(ThreadComment comment) async {
    final confirmed = await ConfirmationModal.show(
      context,
      title: ref.tr('threadsBottomSheet.deleteConfirmation.title'),
      description: ref.tr('threadsBottomSheet.deleteConfirmation.description'),
      confirmLabel: ref.tr('threadsBottomSheet.deleteConfirmation.confirm'),
      cancelLabel: ref.tr('threadsBottomSheet.deleteConfirmation.cancel'),
      confirmVariant: AppButtonVariant.destructive,
    );
    if (confirmed == true) await widget.controller.delete(comment.id);
  }

  Widget _inputRow({
    required String? name,
    required String? imageUrl,
    required TextEditingController controller,
    required VoidCallback onSubmit,
    bool autofocus = false,
    VoidCallback? onBlur,
    Key? key,
  }) {
    final rn = RnSize.of(context);
    return Row(
      key: key,
      children: [
        ReviewUserAvatar(name: name, imageUrl: imageUrl, size: 36),
        SizedBox(width: rn.s(10)),
        Expanded(
          child: Container(
            padding: EdgeInsets.symmetric(vertical: rn.vs(8)),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(100)),
            child: Row(
              children: [
                Expanded(
                  child: Focus(
                    onFocusChange: (focused) {
                      if (!focused) onBlur?.call();
                    },
                    child: TextField(
                      controller: controller,
                      autofocus: autofocus,
                      maxLines: 1,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => onSubmit(),
                      style: _inputStyle,
                      cursorColor: AppColors.primary,
                      decoration: InputDecoration(
                        isCollapsed: true,
                        border: InputBorder.none,
                        hintText: ref.t('review.details.addCommentPlaceholder'),
                        hintStyle: _inputStyle.copyWith(color: AppColors.mediumEmphasis),
                      ),
                    ),
                  ),
                ),
                if (controller.text.trim().isNotEmpty) ...[
                  SizedBox(width: rn.s(8)),
                  SendArrowButton(
                    onPressed: onSubmit,
                    iconSize: 24,
                    isLoading: widget.controller.isSubmitting,
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final controller = widget.controller;
    final user = widget.currentUser;

    final body = <Widget>[];
    if (widget.hasGeneralThread) {
      if (controller.isLoading && controller.comments.isEmpty) {
        body.add(
          Padding(
            padding: EdgeInsets.symmetric(vertical: rn.vs(24)),
            child: const Center(child: CircularProgressIndicator(color: AppColors.primary)),
          ),
        );
      } else if (controller.comments.isEmpty) {
        body.add(
          Padding(
            padding: EdgeInsets.symmetric(vertical: rn.vs(24)),
            child: Text(
              ref.t('review.details.noCommentsYet'),
              textAlign: TextAlign.center,
              style: ReviewText.raw(AppFonts.ibmPlexSerifRegular, 14, null, AppColors.mediumEmphasis),
            ),
          ),
        );
      } else {
        for (final comment in controller.comments) {
          if (controller.editingCommentId == comment.id) {
            body.add(
              _inputRow(
                key: const Key('general-comment-edit-row'),
                name: comment.authorName,
                imageUrl: comment.authorProfileImage,
                controller: _editInput,
                onSubmit: _submitEdit,
                autofocus: true,
                onBlur: controller.cancelEdit,
              ),
            );
          } else {
            body.add(
              ReviewCommentTile(
                comment: comment,
                showReplyButton: !widget.isPrivate,
                onReplyPress: () => widget.onReplyPress(comment),
                onEmojiSelect: (current, unicode) => controller.react(comment.id, current, unicode),
                currentUserId: user?.id,
                reviewOwnerId: widget.reviewOwnerId,
                onEdit: isMinutesPassed(comment.createdAt)
                    ? null
                    : () {
                        _editInput.text = comment.content;
                        controller.startEdit(comment.id);
                      },
                onDelete: () => _delete(comment),
                onHide: (hidden) => controller.setHidden(comment.id, hidden),
                showActionsMenu: !widget.isPrivate,
                disableAddReactionButton: widget.isPrivate,
              ),
            );
          }
        }
        if (controller.hasMore) {
          body.add(
            GestureDetector(
              key: const Key('general-comments-load-more'),
              behavior: HitTestBehavior.opaque,
              onTap: controller.isLoading ? null : controller.loadMore,
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: rn.vs(12)),
                child: Center(
                  child: controller.isLoading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                        )
                      : Text(
                          ref.t('common.loadMore'),
                          style: ReviewText.raw(AppFonts.ibmPlexSerifRegular, 14, null, AppColors.primary),
                        ),
                ),
              ),
            ),
          );
        }
      }
    }

    final children = <Widget>[
      Text(
        ref.t('review.details.comments'),
        style: ReviewText.raw(AppFonts.ibmPlexSerifMedium, 18, 32, AppColors.mediumEmphasis),
      ),
      _inputRow(
        key: const Key('general-comment-input-row'),
        name: user?.name,
        imageUrl: user?.profileImageUrl,
        controller: _input,
        onSubmit: _submit,
      ),
      ...body,
    ];

    return Padding(
      padding: EdgeInsets.only(top: rn.vs(24)),
      child: Column(
        key: const Key('general-comments-section'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (i, child) in children.indexed) ...[if (i > 0) SizedBox(height: rn.vs(16)), child],
        ],
      ),
    );
  }
}

/// Port of RN's `ReviewTranscriptDetails/InteractionsBar`: the floating
/// white pill at the bottom of the review — the "Share" switch (simulation
/// owners), the comments button with its count badge (opens the threads
/// sheet), the review's own emoji reaction, a divider and [ReactionsCount].
class InteractionsBar extends ConsumerWidget {
  const InteractionsBar({
    super.key,
    required this.reviewId,
    required this.reviewType,
    required this.reactions,
    required this.commentsCount,
    required this.myReaction,
    required this.isPrivate,
    required this.onReact,
    this.onCommentPress,
    this.onTogglePrivate,
  });

  final String reviewId;
  final ReviewType reviewType;
  final Map<String, int> reactions;
  final int commentsCount;
  final String? myReaction;
  final bool isPrivate;
  final void Function(String? current, String unicode) onReact;
  final VoidCallback? onCommentPress;
  final ValueChanged<bool>? onTogglePrivate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    Widget circle(Widget child, {Key? key, VoidCallback? onTap}) => GestureDetector(
      key: key,
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        width: 36,
        height: 36,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.strokePrimary, width: 0.5),
        ),
        child: child,
      ),
    );
    final gap = SizedBox(width: rn.s(8));

    return Container(
      key: const Key('interactions-bar'),
      padding: EdgeInsets.only(top: rn.s(8), bottom: rn.s(8), left: rn.s(8), right: rn.s(16)),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
        boxShadow: const [BoxShadow(color: Color(0x17000000), offset: Offset(8, 11), blurRadius: 14.2)],
      ),
      child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (onTogglePrivate != null) ...[
              Text(ref.t('learn.scenario.share'), style: ReviewText.serif(RnType.bodySmall, AppColors.lowEmphasis)),
              const SizedBox(width: 8),
              ReviewSwitch(value: !isPrivate, onToggle: onTogglePrivate!),
              gap,
            ],
            circle(
              key: const Key('interactions-comments'),
              onTap: onCommentPress,
              Stack(
                clipBehavior: Clip.none,
                alignment: Alignment.center,
                children: [
                  SvgPicture.asset('assets/icons/chatBubble.svg', width: rn.raw(20), height: rn.raw(20)),
                  if (commentsCount > 0)
                    Positioned(
                      // top/right 3@s inside the 36pt circle (8pt padding).
                      top: rn.s(3) - 8,
                      right: rn.s(3) - 8,
                      child: Container(
                        constraints: BoxConstraints(minWidth: rn.s(16)),
                        height: rn.s(16),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(999)),
                        child: Text(
                          commentsCount > 99 ? '99+' : '$commentsCount',
                          style: ReviewText.style(RnType.bodyNano, AppFonts.robotoRegular, Colors.white, weight: FontWeight.w500),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            gap,
            circle(ReviewEmojiPicker(onEmojiSelect: onReact, selectedEmoji: myReaction, disabled: isPrivate)),
            gap,
            // height '100%' of the row: the 36pt buttons.
            Container(width: rn.s(0.5), height: 36, color: AppColors.strokePrimary),
            gap,
            Flexible(child: ReactionsCount(reviewId: reviewId, reactions: reactions, reviewType: reviewType)),
          ],
        ),
    );
  }
}
