import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../reactions/data/emoji_catalog.dart';
import '../data/review_models.dart';
import 'comment_list_controller.dart';
import 'review_formatting.dart';
import 'review_styles.dart';
import '../../../core/widgets/sized_network_image.dart';

/// Port of RN's shared `UserProfileImage`: a circle with a 1pt lightGray17
/// (#D2D2D2) border on lightGray, showing the image or the name's first
/// letter (IBM Plex Serif Medium, black) in `typography.body[textSize]`.
class ReviewUserAvatar extends StatelessWidget {
  const ReviewUserAvatar({
    super.key,
    required this.name,
    required this.imageUrl,
    required this.size,
    this.textStyle = RnType.bodyMedium,
  });

  final String? name;
  final String? imageUrl;
  final double size;
  final TextStyle textStyle;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    final initial = (name ?? '').trim();
    return Container(
      width: size,
      height: size,
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.lightGray,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.strokePrimary),
      ),
      child: (url != null && url.isNotEmpty)
          ? SizedNetworkImage(
              url,
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const SizedBox.shrink(),
            )
          : Text(
              initial.isEmpty ? '' : initial[0].toUpperCase(),
              style: textStyle.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium, color: Colors.black),
            ),
    );
  }
}

/// An emoji glyph in RN's default `<Text>` (system font, 14pt).
TextStyle _emojiStyle(double fontSize) => TextStyle(fontFamily: systemFontFamily, fontSize: fontSize);

/// A popup anchored to [child] in the nearest [Overlay], dismissed by
/// tapping anywhere else — the transparent full-screen `Modal`/overlay RN's
/// `EmojiPicker`, `ActionsMenu` and floating "Add comment" menu each draw.
class _AnchoredPopup extends StatefulWidget {
  const _AnchoredPopup({
    required this.controller,
    required this.child,
    required this.popupBuilder,
    required this.targetAnchor,
    required this.followerAnchor,
    this.offset = Offset.zero,
  });

  final OverlayPortalController controller;
  final Widget child;
  final WidgetBuilder popupBuilder;
  final Alignment targetAnchor;
  final Alignment followerAnchor;
  final Offset offset;

  @override
  State<_AnchoredPopup> createState() => _AnchoredPopupState();
}

class _AnchoredPopupState extends State<_AnchoredPopup> {
  final _link = LayerLink();

  @override
  Widget build(BuildContext context) {
    return CompositedTransformTarget(
      link: _link,
      child: OverlayPortal(
        controller: widget.controller,
        overlayChildBuilder: (context) => Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: widget.controller.hide,
              ),
            ),
            CompositedTransformFollower(
              link: _link,
              targetAnchor: widget.targetAnchor,
              followerAnchor: widget.followerAnchor,
              offset: widget.offset,
              child: Align(
                alignment: widget.followerAnchor,
                widthFactor: 1,
                heightFactor: 1,
                child: widget.popupBuilder(context),
              ),
            ),
          ],
        ),
        child: widget.child,
      ),
    );
  }
}

/// Port of RN's `EmojiPicker`: the add-reaction icon (or the chosen emoji)
/// opens a white pill of [kPlatformEmojiIds] above it; picking one calls
/// [onEmojiSelect] with the previous choice (RN's `getReactionAction`
/// inputs) and toggles the local selection.
class ReviewEmojiPicker extends StatefulWidget {
  const ReviewEmojiPicker({
    super.key,
    required this.onEmojiSelect,
    this.selectedEmoji,
    this.disabled = false,
    this.containerOffsetX = 0,
  });

  final void Function(String? currentEmoji, String unicode) onEmojiSelect;
  final String? selectedEmoji;
  final bool disabled;

  /// RN's `containerOffsetX` — shifts the pill right of the icon's centre.
  final double containerOffsetX;

  @override
  State<ReviewEmojiPicker> createState() => _ReviewEmojiPickerState();
}

class _ReviewEmojiPickerState extends State<ReviewEmojiPicker> {
  final _controller = OverlayPortalController();
  late String? _current = widget.selectedEmoji;

  @override
  void didUpdateWidget(ReviewEmojiPicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedEmoji != widget.selectedEmoji) _current = widget.selectedEmoji;
    if (widget.disabled && _controller.isShowing) _controller.hide();
  }

  void _select(String unicode) {
    widget.onEmojiSelect(_current, unicode);
    setState(() => _current = _current == unicode ? null : unicode);
    _controller.hide();
  }

  @override
  Widget build(BuildContext context) {
    final current = _current;
    return _AnchoredPopup(
      controller: _controller,
      targetAnchor: Alignment.topCenter,
      followerAnchor: Alignment.bottomCenter,
      // styles.emojiContainer: bottom 100% + marginBottom 8.
      offset: Offset(widget.containerOffsetX, -8),
      popupBuilder: (context) => Container(
        key: const Key('emoji-picker-popup'),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: AppColors.lightGray4, width: 0.5),
          boxShadow: const [BoxShadow(color: Color(0x26000000), offset: Offset(0, 4), blurRadius: 8)],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final (i, unicode) in kPlatformEmojiIds.indexed) ...[
              if (i > 0) const SizedBox(width: 4),
              GestureDetector(
                key: ValueKey('emoji-option-$unicode'),
                onTap: () => _select(unicode),
                child: Container(
                  width: 36,
                  height: 36,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: current == unicode ? AppColors.grey200 : Colors.white,
                    border: Border.all(color: AppColors.lightGray4, width: 0.5),
                    boxShadow: const [BoxShadow(color: Color(0x33DBDBDB), offset: Offset(0, 1), blurRadius: 2)],
                  ),
                  child: Text(emojiGlyphFor(unicode), style: _emojiStyle(20)),
                ),
              ),
            ],
          ],
        ),
      ),
      child: GestureDetector(
        key: const Key('emoji-picker-button'),
        behavior: HitTestBehavior.opaque,
        onTap: widget.disabled ? null : () => _controller.isShowing ? _controller.hide() : _controller.show(),
        child: Opacity(
          opacity: widget.disabled ? 0.5 : 1,
          child: current != null
              ? Text(emojiGlyphFor(current), style: _emojiStyle(14))
              : SvgPicture.asset(
                  'assets/icons/addReaction.svg',
                  width: 19,
                  height: 19,
                  colorFilter: const ColorFilter.mode(AppColors.iconDefault, BlendMode.srcIn),
                ),
        ),
      ),
    );
  }
}

/// One row of RN's `ActionsMenu`.
typedef ReviewMenuOption = ({String label, VoidCallback onPress});

/// Port of RN's `ActionsMenu`: a three-dots trigger opening a small white
/// card of text options, right-aligned under the trigger.
class ReviewActionsMenu extends StatefulWidget {
  const ReviewActionsMenu({super.key, required this.options, this.iconSize = 24});

  final List<ReviewMenuOption> options;
  final double iconSize;

  @override
  State<ReviewActionsMenu> createState() => _ReviewActionsMenuState();
}

class _ReviewActionsMenuState extends State<ReviewActionsMenu> {
  final _controller = OverlayPortalController();

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return _AnchoredPopup(
      controller: _controller,
      targetAnchor: Alignment.bottomRight,
      followerAnchor: Alignment.topRight,
      offset: const Offset(0, 4),
      popupBuilder: (context) => Container(
        constraints: BoxConstraints(minWidth: rn.s(160)),
        padding: EdgeInsets.symmetric(vertical: rn.s(8)),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          boxShadow: const [BoxShadow(color: Color(0x1A6C6C6C), offset: Offset(2, 4), blurRadius: 11)],
        ),
        child: IntrinsicWidth(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final option in widget.options)
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () {
                    _controller.hide();
                    option.onPress();
                  },
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: rn.s(10), horizontal: rn.s(16)),
                    child: Text(
                      option.label,
                      style: ReviewText.style(
                        RnType.bodySmall,
                        AppFonts.ibmPlexSerifRegular,
                        Colors.black,
                        weight: FontWeight.w500,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
      child: GestureDetector(
        key: const Key('comment-actions-menu'),
        behavior: HitTestBehavior.opaque,
        onTap: _controller.show,
        child: SizedBox(
          width: widget.iconSize,
          height: widget.iconSize,
          child: SvgPicture.asset(
            'assets/icons/threeDots.svg',
            colorFilter: const ColorFilter.mode(AppColors.iconDefault, BlendMode.srcIn),
          ),
        ),
      ),
    );
  }
}

/// Port of RN's shared `ReviewComment`: avatar, name + relative time (+ a
/// "Hidden" badge), an optional actions menu (Edit/Delete for the comment's
/// author, Hide/Unhide for the review's owner), the text, and a footer with
/// the reaction picker, up to three reaction bubbles + count, and
/// Reply / reply-count links.
class ReviewCommentTile extends ConsumerWidget {
  const ReviewCommentTile({
    super.key,
    required this.comment,
    this.onCommentPress,
    this.onReplyPress,
    this.onEmojiSelect,
    this.showReplyButton = true,
    this.showAddReactionButton = true,
    this.disableAddReactionButton = false,
    this.showActionsMenu = false,
    this.currentUserId,
    this.reviewOwnerId,
    this.onEdit,
    this.onDelete,
    this.onHide,
  });

  final ThreadComment comment;
  final VoidCallback? onCommentPress;
  final VoidCallback? onReplyPress;
  final void Function(String? currentEmoji, String unicode)? onEmojiSelect;
  final bool showReplyButton;
  final bool showAddReactionButton;
  final bool disableAddReactionButton;
  final bool showActionsMenu;
  final int? currentUserId;
  final int? reviewOwnerId;

  /// Only passed while the comment is inside its edit window (RN spreads
  /// `onEdit` in only when `!isMinutesPassed(createdAt)`).
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  final void Function(bool hidden)? onHide;

  static final _name = ReviewText.raw(AppFonts.ibmPlexSerifMedium, 14, 18, AppColors.highEmphasis);
  static final _time = ReviewText.raw(AppFonts.ibmPlexSerifRegular, 12, 15, AppColors.mediumEmphasis);
  static final _text = ReviewText.raw(AppFonts.ibmPlexSerifRegular, 13, 16, AppColors.highEmphasis);
  static final _footerText = ReviewText.raw(AppFonts.ibmPlexSerifRegular, 12, 16, AppColors.mediumEmphasis);
  static final _repliesText = ReviewText.raw(AppFonts.ibmPlexSerifRegular, 12, 18, AppColors.mediumEmphasis);
  static final _reactionCount = ReviewText.raw(AppFonts.ibmPlexSerifRegular, 12, 21, AppColors.mediumEmphasis);

  List<ReviewMenuOption> _menuOptions(WidgetRef ref) {
    final isAuthor = currentUserId != null && comment.authorId != null && currentUserId == comment.authorId;
    return [
      if (isAuthor && onEdit != null && !comment.hidden) (label: ref.t('review.details.edit'), onPress: onEdit!),
      if (isAuthor && !comment.hidden) (label: ref.t('review.details.delete'), onPress: () => onDelete?.call()),
      if (currentUserId != null && reviewOwnerId != null && currentUserId == reviewOwnerId)
        (
          label: ref.t(comment.hidden ? 'review.details.unhide' : 'review.details.hide'),
          onPress: () => onHide?.call(!comment.hidden),
        ),
    ];
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    final options = _menuOptions(ref);
    final reactions = [
      for (final entry in comment.reactions.entries)
        if (entry.value > 0) emojiGlyphFor(entry.key),
    ];
    final reactionCount = comment.reactions.values.fold(0, (sum, v) => sum + v);
    final replyCount = comment.replyCount;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onCommentPress,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ReviewUserAvatar(name: comment.authorName, imageUrl: comment.authorProfileImage, size: rn.raw(36)),
          SizedBox(width: rn.s(10)),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(comment.authorName, maxLines: 1, overflow: TextOverflow.ellipsis, style: _name),
                          ),
                          SizedBox(width: rn.s(6)),
                          Text(
                            comment.createdAt == null ? '' : formatReviewRelativeTime(ref, comment.createdAt!),
                            style: _time,
                          ),
                          if (comment.hidden) ...[
                            SizedBox(width: rn.s(6)),
                            Container(
                              padding: EdgeInsets.symmetric(horizontal: rn.s(4), vertical: rn.s(2)),
                              decoration: BoxDecoration(
                                color: AppColors.lightGray,
                                borderRadius: BorderRadius.circular(rn.s(100)),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  SvgPicture.asset('assets/icons/eyeClosed.svg', width: 16, height: 16),
                                  SizedBox(width: rn.s(4)),
                                  Text(
                                    ref.t('review.hidden'),
                                    style: ReviewText.raw(AppFonts.ibmPlexSerifRegular, 11, 14, Colors.black.withValues(alpha: 0.8)),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (showActionsMenu && options.isNotEmpty) ...[
                      SizedBox(width: rn.s(6)),
                      ReviewActionsMenu(options: options, iconSize: 18),
                    ],
                  ],
                ),
                SizedBox(height: rn.mvs(4)),
                Text(
                  comment.content,
                  style: comment.hidden ? _text.copyWith(color: AppColors.lowEmphasis) : _text,
                ),
                SizedBox(height: rn.mvs(8)),
                Opacity(
                  opacity: comment.hidden ? 0.6 : 1,
                  child: Row(
                    children: [
                      if (showAddReactionButton) ...[
                        if (disableAddReactionButton)
                          SvgPicture.asset(
                            'assets/icons/addReaction.svg',
                            width: 16,
                            height: 16,
                            colorFilter: const ColorFilter.mode(AppColors.iconDefault, BlendMode.srcIn),
                          )
                        else
                          ReviewEmojiPicker(
                            containerOffsetX: 70,
                            onEmojiSelect: onEmojiSelect ?? (_, _) {},
                            selectedEmoji: comment.myReaction,
                          ),
                        const SizedBox(width: 4),
                      ],
                      if (reactions.isNotEmpty) ...[
                        _ReactionBubbles(emojis: reactions),
                        if (reactionCount > 0) ...[
                          const SizedBox(width: 4),
                          Text('$reactionCount', style: _reactionCount),
                        ],
                        const SizedBox(width: 4),
                      ],
                      if (replyCount > 0 || showReplyButton) ...[
                        Container(
                          width: 3,
                          height: 3,
                          decoration: const BoxDecoration(color: AppColors.lightGrayD9, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 4),
                      ],
                      if (showReplyButton) ...[
                        GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: onReplyPress,
                          child: Text(ref.t('review.details.replyLabel'), style: _footerText),
                        ),
                        const SizedBox(width: 4),
                      ],
                      if (replyCount > 0)
                        GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: onReplyPress,
                          child: Text(
                            // RN's getRepliesText: "Reply" for one, else
                            // review.details.comment_one ("{{count}} Comment").
                            replyCount == 1
                                ? ref.t('review.details.replyLabel')
                                : ref.t('review.details.comment_one', {'count': replyCount}),
                            style: _repliesText,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// ReviewComment's overlapping 16pt reaction bubbles (first three).
class _ReactionBubbles extends StatelessWidget {
  const _ReactionBubbles({required this.emojis});

  final List<String> emojis;

  @override
  Widget build(BuildContext context) {
    final shown = emojis.take(3).toList();
    return SizedBox(
      height: 16,
      width: 16 + (shown.length - 1) * 10,
      child: Stack(
        children: [
          for (var i = shown.length - 1; i >= 0; i--)
            Positioned(
              left: i * 10.0,
              child: Container(
                width: 16,
                height: 16,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.strokePrimary, width: 0.31),
                ),
                child: Text(
                  shown[i],
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 8.62,
                    height: 12 / 8.62,
                    fontWeight: FontWeight.w500,
                    color: AppColors.darkGray17,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A [ReviewCommentTile] wired to a [CommentListController] — the props
/// every RN comment list passes (`onEmojiSelect`, `onEdit` within the edit
/// window, `onDelete` behind a confirmation, `onHide`).
class ControlledCommentTile extends StatelessWidget {
  const ControlledCommentTile({
    super.key,
    required this.comment,
    required this.controller,
    required this.isPrivate,
    required this.currentUserId,
    required this.reviewOwnerId,
    required this.onDelete,
    this.onReplyPress,
    this.showReplyButton = true,
    this.disableAddReactionButton = false,
  });

  final ThreadComment comment;
  final CommentListController controller;
  final bool isPrivate;
  final int? currentUserId;
  final int? reviewOwnerId;
  final VoidCallback onDelete;
  final VoidCallback? onReplyPress;
  final bool showReplyButton;
  final bool disableAddReactionButton;

  @override
  Widget build(BuildContext context) {
    return ReviewCommentTile(
      comment: comment,
      showReplyButton: showReplyButton,
      onReplyPress: onReplyPress,
      onEmojiSelect: (current, unicode) => controller.react(comment.id, current, unicode),
      currentUserId: currentUserId,
      reviewOwnerId: reviewOwnerId,
      onEdit: isMinutesPassed(comment.createdAt) ? null : () => controller.startEdit(comment.id),
      onDelete: onDelete,
      onHide: (hidden) => controller.setHidden(comment.id, hidden),
      showActionsMenu: !isPrivate,
      disableAddReactionButton: disableAddReactionButton,
    );
  }
}

/// Port of RN's `CustomSwitch` — a 32x18 pill whose 16pt white thumb slides
/// across; the track goes from grey200 to [color] when on.
class ReviewSwitch extends StatelessWidget {
  const ReviewSwitch({super.key, required this.value, required this.onToggle, this.color = AppColors.green200});

  final bool value;
  final ValueChanged<bool> onToggle;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: const Key('review-share-switch'),
      onTap: () => onToggle(!value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 32,
        height: 18,
        padding: const EdgeInsets.all(1),
        decoration: BoxDecoration(
          color: value ? color : AppColors.grey200,
          borderRadius: BorderRadius.circular(9),
        ),
        child: AnimatedAlign(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
          alignment: value ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            width: 16,
            height: 16,
            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
          ),
        ),
      ),
    );
  }
}

/// RN's `pluralize(value, unit)`: "1 reaction", "3 reactions".
String pluralize(int value, String unit) => '$value $unit${value == 1 ? '' : 's'}';

/// Port of RN's `ReviewScreen/components/ReactionsCount`: the top three
/// reactions as overlapping bubbles plus "N reactions"; opens the
/// Reactions screen.
class ReactionsCount extends ConsumerWidget {
  const ReactionsCount({super.key, required this.reviewId, required this.reactions, required this.reviewType});

  final String reviewId;
  final Map<String, int> reactions;
  final ReviewType reviewType;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    final total = reactions.values.fold(0, (sum, v) => sum + v);
    // RN's getTopReactions(reactions, 3): sorted by count, descending.
    final top = (reactions.entries.toList()..sort((a, b) => b.value.compareTo(a.value)))
        .take(3)
        .map((e) => e.key)
        .toList();

    return GestureDetector(
      key: const Key('reactions-count'),
      behavior: HitTestBehavior.opaque,
      onTap: () => context.push('/reactions/$reviewId', extra: reviewType),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (i, code) in top.indexed)
            NegativeRightMargin(
              // marginRight -8@s on all but the last bubble.
              margin: i < top.length - 1 ? rn.s(8) : 0,
              child: Container(
                padding: EdgeInsets.all(rn.s(4)),
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.strokePrimary, width: 0.5),
                ),
                child: Text(emojiGlyphFor(code), style: _emojiStyle(14)),
              ),
            ),
          if (top.isNotEmpty) SizedBox(width: rn.s(8)),
          Flexible(
            child: Text(
            pluralize(total, ref.t('review.feedCard.reactions')),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: ReviewText.serif(RnType.bodySmall, AppColors.mediumEmphasis),
          )
          ),
        ],
      ),
    );
  }
}

/// RN's 32pt primary circle with the left-arrow icon turned 180°, used by
/// every comment input (CommentInput, CommentBottomSheetFooter,
/// GeneralCommentsSection).
class SendArrowButton extends StatelessWidget {
  const SendArrowButton({
    super.key,
    required this.onPressed,
    this.enabled = true,
    this.isLoading = false,
    this.iconSize = 32,
    this.disabledColor = AppColors.lowEmphasis,
  });

  final VoidCallback? onPressed;
  final bool enabled;
  final bool isLoading;
  final double iconSize;
  final Color disabledColor;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: const Key('comment-send-button'),
      onTap: enabled && !isLoading ? onPressed : null,
      child: Container(
        width: 32,
        height: 32,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: enabled ? AppColors.primary : disabledColor, shape: BoxShape.circle),
        child: isLoading
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
              )
            : OverflowBox(
                maxWidth: iconSize,
                maxHeight: iconSize,
                child: Transform.rotate(
                  angle: math.pi,
                  child: SizedBox(
                    width: iconSize,
                    height: iconSize,
                    child: SvgPicture.asset(
                      'assets/icons/leftArrowIcon.svg',
                      colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
                    ),
                  ),
                ),
              ),
      ),
    );
  }
}

/// Port of RN's `CommentBottomSheetFooter`: a rounded single-line input and
/// the send button, pinned under a comment sheet.
class CommentFooterInput extends StatefulWidget {
  const CommentFooterInput({
    super.key,
    required this.placeholder,
    required this.onSubmit,
    this.isLoading = false,
    this.controller,
  });

  final String placeholder;
  final ValueChanged<String> onSubmit;
  final bool isLoading;
  final TextEditingController? controller;

  @override
  State<CommentFooterInput> createState() => _CommentFooterInputState();
}

class _CommentFooterInputState extends State<CommentFooterInput> {
  late final TextEditingController _controller = widget.controller ?? TextEditingController();

  @override
  void initState() {
    super.initState();
    _controller.addListener(_rebuild);
  }

  void _rebuild() => setState(() {});

  @override
  void dispose() {
    _controller.removeListener(_rebuild);
    if (widget.controller == null) _controller.dispose();
    super.dispose();
  }

  void _send() {
    final text = _controller.text;
    if (text.trim().isEmpty) return;
    widget.onSubmit(text);
    _controller.clear();
    FocusScope.of(context).unfocus();
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final hasText = _controller.text.trim().isNotEmpty;
    return Container(
      color: Colors.white,
      padding: EdgeInsets.symmetric(horizontal: rn.s(24), vertical: rn.vs(16)),
      child: Row(
        children: [
          Expanded(
            child: ReviewPillInput(
              controller: _controller,
              placeholder: widget.placeholder,
              onSubmitted: (_) => _send(),
            ),
          ),
          SizedBox(width: rn.s(10)),
          SendArrowButton(onPressed: _send, enabled: hasText, isLoading: widget.isLoading),
        ],
      ),
    );
  }
}

/// The bordered, fully-rounded single-line input of RN's
/// `CommentBottomSheetFooter` / `CommentInput`.
class ReviewPillInput extends StatelessWidget {
  const ReviewPillInput({
    super.key,
    required this.controller,
    required this.placeholder,
    this.onSubmitted,
    this.fillColor = Colors.white,
    this.autofocus = false,
    this.textStyle,
  });

  final TextEditingController controller;
  final String placeholder;
  final ValueChanged<String>? onSubmitted;
  final Color fillColor;
  final bool autofocus;
  final TextStyle? textStyle;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final style = textStyle ??
        ReviewText.raw(AppFonts.ibmPlexSerifRegular, 14, 20, AppColors.highEmphasis, letterSpacing: 0.25);
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(100),
      borderSide: const BorderSide(color: AppColors.strokePrimary, width: 0.5),
    );
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 36),
      child: TextField(
        controller: controller,
        autofocus: autofocus,
        maxLines: 1,
        textInputAction: TextInputAction.send,
        onSubmitted: onSubmitted,
        style: style,
        cursorColor: AppColors.primary,
        decoration: InputDecoration(
          isDense: true,
          filled: true,
          fillColor: fillColor,
          hintText: placeholder,
          hintStyle: style.copyWith(color: AppColors.mediumEmphasis),
          contentPadding: EdgeInsets.symmetric(horizontal: rn.s(8), vertical: rn.vs(8)),
          border: border,
          enabledBorder: border,
          focusedBorder: border,
        ),
      ),
    );
  }
}

/// The centred 18/32 title of RN's comment sheets (`styles.header`).
class ReviewSheetTitle extends StatelessWidget {
  const ReviewSheetTitle({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return Padding(
      padding: EdgeInsets.only(left: rn.s(24), right: rn.s(24), bottom: rn.mvs(8)),
      child: Text(title, textAlign: TextAlign.center, style: ReviewText.sheetTitle),
    );
  }
}

/// Port of RN's `BottomSheetBackHeader`: a small back chevron on the left
/// and the title centred across the full width.
class ReviewSheetBackHeader extends StatelessWidget {
  const ReviewSheetBackHeader({super.key, required this.title, required this.onBack});

  final String title;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return Padding(
      padding: EdgeInsets.only(left: rn.s(24), right: rn.s(24), top: rn.vs(8), bottom: rn.mvs(8)),
      child: Stack(
        alignment: Alignment.center,
        children: [
          Text(
            title,
            textAlign: TextAlign.center,
            style: ReviewText.sheetTitle.copyWith(color: AppColors.highEmphasis),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: GestureDetector(
              key: const Key('sheet-back-button'),
              behavior: HitTestBehavior.opaque,
              onTap: onBack,
              child: Padding(
                padding: EdgeInsets.all(rn.s(8)),
                child: Transform.translate(
                  offset: Offset(-rn.s(8), 0),
                  child: SizedBox(
                    width: 12,
                    height: 15,
                    child: SvgPicture.asset(
                      'assets/icons/leftArrow.svg',
                      colorFilter: const ColorFilter.mode(AppColors.highEmphasis, BlendMode.srcIn),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// RN's negative `marginRight`: lays [child] out at its own size but takes
/// up [margin] less width, so the next sibling overlaps it.
class NegativeRightMargin extends SingleChildRenderObjectWidget {
  const NegativeRightMargin({super.key, required this.margin, super.child});

  final double margin;

  @override
  RenderObject createRenderObject(BuildContext context) => RenderNegativeRightMargin(margin);

  @override
  void updateRenderObject(BuildContext context, RenderNegativeRightMargin renderObject) {
    renderObject.margin = margin;
  }
}

class RenderNegativeRightMargin extends RenderProxyBox {
  RenderNegativeRightMargin(this._margin);

  double _margin;
  set margin(double value) {
    if (value == _margin) return;
    _margin = value;
    markNeedsLayout();
  }

  @override
  void performLayout() {
    final child = this.child;
    if (child == null) {
      size = constraints.smallest;
      return;
    }
    child.layout(constraints.loosen(), parentUsesSize: true);
    size = constraints.constrain(Size(math.max(0, child.size.width - _margin), child.size.height));
  }

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      child?.hitTest(result, position: position) ?? false;
}
