import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../data/review_models.dart';
import 'review_styles.dart';

/// RN `Conversation`'s `formatTimestamp`: "mm:ss" from `startSeconds`.
String formatTranscriptTimestamp(double startSeconds) {
  final minutes = startSeconds ~/ 60;
  final seconds = (startSeconds % 60).floor();
  return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
}

/// Maps a selection in the rendered "Speaker: message" string back to
/// offsets into the message's own `content`, exactly as RN's
/// `IosCommentableText` does: both ends are clamped to the end of the
/// prefix, the prefix length is subtracted, and the selected text is the
/// clamped slice of the displayed string. Null for an empty selection.
ReviewTextSelection? selectionToMessageRange({
  required String displayText,
  required int prefixLength,
  required int start,
  required int end,
}) {
  final lo = start < end ? start : end;
  final hi = start < end ? end : start;
  final clampedStart = lo < prefixLength ? prefixLength : lo;
  final clampedEnd = hi < prefixLength ? prefixLength : hi;
  if (clampedStart == clampedEnd) return null;
  final text = displayText.substring(clampedStart, clampedEnd.clamp(0, displayText.length));
  if (text.isEmpty) return null;
  return ReviewTextSelection(
    startIndex: clampedStart - prefixLength,
    endIndex: clampedEnd - prefixLength,
    selectedText: text,
  );
}

/// One transcript line of RN's `Conversation` (`Message` row): the
/// "mm:ss" timestamp, then "Speaker: text" — the speaker in IBM Plex Serif
/// Medium (primary for the review owner, black for the client), commented
/// ranges tinted amber with an amber underline.
///
/// When [selectable] (RN: `!isPrivate && canEditThread`), the text is a
/// [SelectableText] whose selection menu offers only "Add comment" — RN's
/// native `IosCommentableText` + floating menu — and reports the selection
/// as offsets into the message content via [selectionToMessageRange].
/// Tapping a commented range opens its threads ([onThreadsTap], RN's
/// `onCommentIdsPress`), when the user may view threads.
class TranscriptMessageRow extends StatefulWidget {
  const TranscriptMessageRow({
    super.key,
    required this.message,
    required this.senderName,
    required this.selectable,
    required this.addCommentLabel,
    this.onAddComment,
    this.onThreadsTap,
  });

  final TranscriptMessage message;
  final String senderName;
  final bool selectable;
  final String addCommentLabel;
  final ValueChanged<ReviewTextSelection>? onAddComment;
  final ValueChanged<List<String>>? onThreadsTap;

  static final messageStyle = ReviewText.serif(RnType.bodyMedium, AppColors.highEmphasis);
  static final ownerStyle = ReviewText.serifMedium(RnType.bodyMedium, AppColors.primary);
  static final clientStyle = ReviewText.serifMedium(RnType.bodyMedium, Colors.black);
  static final timestampStyle = ReviewText.serif(RnType.bodyMedium, AppColors.mediumEmphasis);
  static const highlightStyle = TextStyle(
    backgroundColor: AppColors.transcriptHighlight,
    decoration: TextDecoration.underline,
    decorationColor: AppColors.amber500,
    decorationThickness: 1,
  );

  @override
  State<TranscriptMessageRow> createState() => _TranscriptMessageRowState();
}

class _TranscriptMessageRowState extends State<TranscriptMessageRow> {
  final List<TapGestureRecognizer> _recognizers = [];

  @override
  void dispose() {
    _disposeRecognizers();
    super.dispose();
  }

  void _disposeRecognizers() {
    for (final r in _recognizers) {
      r.dispose();
    }
    _recognizers.clear();
  }

  String get _prefix => '${widget.senderName}: ';

  TextSpan _span() {
    _disposeRecognizers();
    final message = widget.message;
    return TextSpan(
      style: TranscriptMessageRow.messageStyle,
      children: [
        TextSpan(
          text: _prefix,
          style: message.isClient ? TranscriptMessageRow.clientStyle : TranscriptMessageRow.ownerStyle,
        ),
        for (final part in message.parts)
          if (part.commentIds.isEmpty)
            TextSpan(text: part.text)
          else
            TextSpan(
              text: part.text,
              style: TranscriptMessageRow.highlightStyle,
              recognizer: widget.onThreadsTap == null || !widget.selectable
                  ? null
                  : (TapGestureRecognizer()..onTap = () => widget.onThreadsTap!(part.commentIds))
                        .also(_recognizers.add),
            ),
      ],
    );
  }

  Widget _contextMenu(BuildContext context, EditableTextState state) {
    final value = state.textEditingValue;
    final range = selectionToMessageRange(
      displayText: value.text,
      prefixLength: _prefix.length,
      start: value.selection.start,
      end: value.selection.end,
    );
    if (range == null) return const SizedBox.shrink();

    final overlayBox = Overlay.of(context).context.findRenderObject() as RenderBox?;
    Offset toLocal(Offset global) => overlayBox?.globalToLocal(global) ?? global;
    final anchors = state.contextMenuAnchors;
    final above = toLocal(anchors.primaryAnchor);
    final below = toLocal(anchors.secondaryAnchor ?? anchors.primaryAnchor);

    return CustomSingleChildLayout(
      delegate: TextSelectionToolbarLayoutDelegate(
        anchorAbove: above - const Offset(0, 8),
        anchorBelow: below + const Offset(0, 8),
      ),
      child: _AddCommentMenu(
        label: widget.addCommentLabel,
        onPressed: () {
          state.hideToolbar();
          state.userUpdateTextEditingValue(
            value.copyWith(selection: TextSelection.collapsed(offset: value.selection.end)),
            SelectionChangedCause.toolbar,
          );
          widget.onAddComment?.call(range);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final span = _span();
    return Padding(
      padding: EdgeInsets.symmetric(vertical: rn.mvs(6)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            formatTranscriptTimestamp(widget.message.startSeconds),
            maxLines: 1,
            style: TranscriptMessageRow.timestampStyle,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: widget.selectable
                ? SelectableText.rich(
                    span,
                    key: ValueKey('transcript-message-${widget.message.id}'),
                    contextMenuBuilder: _contextMenu,
                  )
                : Text.rich(span, key: ValueKey('transcript-message-${widget.message.id}')),
          ),
        ],
      ),
    );
  }
}

extension<T> on T {
  T also(void Function(T) f) {
    f(this);
    return this;
  }
}

/// RN's floating "Add comment" menu: a 140x44 surface-background card,
/// radius 8, soft shadow, one IBM Plex Serif body.medium item.
class _AddCommentMenu extends StatelessWidget {
  const _AddCommentMenu({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: const Key('add-comment-menu'),
      behavior: HitTestBehavior.opaque,
      onTap: onPressed,
      child: Container(
        width: 140,
        height: 44,
        alignment: Alignment.centerLeft,
        padding: EdgeInsets.symmetric(horizontal: RnSize.of(context).raw(12)),
        decoration: BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.circular(RnSize.of(context).raw(8)),
          boxShadow: const [BoxShadow(color: Color(0x40000000), offset: Offset(0, 2), blurRadius: 3.84)],
        ),
        child: Text(label, style: ReviewText.style(RnType.bodyMedium, AppFonts.ibmPlexSerifRegular, AppColors.highEmphasis)),
      ),
    );
  }
}
