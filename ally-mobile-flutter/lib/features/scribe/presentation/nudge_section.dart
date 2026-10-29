import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../data/chat_models.dart';
import '../data/chat_repository.dart';

/// Port of ally-mobile (React Native)'s `ListeningScreen/components/
/// NudgeSection`: a translucent card (radius 16, 0.5 `gunmetal` border,
/// `smokyBlack`) holding the AI nudge rendered by RN's `CustomMarkdown`
/// in a scroll capped at 80vs, then "Is this helpful?" (always) above a
/// 0.5 `teal` rule, with thumbs down/up only for EDIT_MESSAGE_FEEDBACK.
/// While a nudge is arriving it shows RN's `SkeletonLoader` shimmer.
///
/// Feedback: re-tapping the rating already given is a no-op; a nudge that
/// already has feedback is PATCHed, otherwise POSTed; taps are debounced
/// on the leading edge (500 ms), as RN's `useDebounce({leading: true})`.
class NudgeSection extends ConsumerStatefulWidget {
  const NudgeSection({super.key, required this.nudge, this.isLoading = false, this.onFeedbackSuccess});

  final Nudge? nudge;
  final bool isLoading;

  /// RN `handleNudgeFeedbackSuccess`: the caller patches `.feedback` onto
  /// its current nudge.
  final ValueChanged<NudgeFeedback>? onFeedbackSuccess;

  @override
  ConsumerState<NudgeSection> createState() => _NudgeSectionState();
}

class _NudgeSectionState extends ConsumerState<NudgeSection> {
  bool _isSubmitting = false;
  Timer? _debounce;

  // Kept locally too, so the thumbs reflect a rating even when the caller
  // doesn't patch it back. Reset when a different nudge arrives.
  NudgeFeedback? _lastFeedback;

  @override
  void didUpdateWidget(covariant NudgeSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.nudge?.id != widget.nudge?.id) _lastFeedback = null;
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _onThumb(int rating) {
    if (_debounce?.isActive ?? false) return;
    _debounce = Timer(const Duration(milliseconds: 500), () {});
    _submitRating(rating);
  }

  Future<void> _submitRating(int rating) async {
    final nudge = widget.nudge;
    final current = _lastFeedback ?? nudge?.feedback;
    if (nudge == null || _isSubmitting || current?.rating == rating) return;
    setState(() => _isSubmitting = true);
    try {
      final repository = ref.read(chatRepositoryProvider);
      final feedback = current != null
          ? await repository.updateFeedback(current.feedbackId, rating)
          : await repository.addFeedback(nudge.id, rating);
      if (!mounted) return;
      setState(() => _lastFeedback = feedback);
      widget.onFeedbackSuccess?.call(feedback);
    } catch (_) {
      // RN only logs.
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final nudge = widget.nudge;
    Widget? content;
    if (widget.isLoading) {
      content = const _NudgeSkeleton(key: ValueKey('nudge-section-loading'));
    } else if (nudge != null) {
      final canRate = ref.watch(userPermissionsProvider).value?.contains(UserPermissions.editMessageFeedback) ?? false;
      final rating = (_lastFeedback ?? nudge.feedback)?.rating;
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: rn.vs(80)),
            child: SingleChildScrollView(child: NudgeMarkdown(content: nudge.content)),
          ),
          Container(
            padding: EdgeInsets.only(top: rn.vs(8)),
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.teal, width: 0.5))),
            child: Row(
              children: [
                Text(
                  ref.t('listeningScreen.isThisHelpful'),
                  style: const TextStyle(
                    fontFamily: AppFonts.robotoRegular,
                    fontSize: 14,
                    height: 22 / 14,
                    letterSpacing: 0.25,
                    color: Colors.white,
                  ),
                ),
                if (canRate) ...[
                  SizedBox(width: rn.s(9)),
                  _Thumb(
                    key: const ValueKey('nudge-thumb-down'),
                    isDown: true,
                    selected: rating == 0,
                    onTap: _isSubmitting ? null : () => _onThumb(0),
                  ),
                  SizedBox(width: rn.s(9)),
                  _Thumb(
                    key: const ValueKey('nudge-thumb-up'),
                    isDown: false,
                    selected: rating == 1,
                    onTap: _isSubmitting ? null : () => _onThumb(1),
                  ),
                ],
              ],
            ),
          ),
        ],
      );
    }

    return Container(
      key: const ValueKey('nudge-section'),
      width: double.infinity,
      margin: EdgeInsets.only(top: rn.vs(10)),
      decoration: BoxDecoration(
        color: AppColors.smokyBlack,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.gunmetal, width: 0.5),
      ),
      clipBehavior: Clip.antiAlias,
      padding: const EdgeInsets.all(12),
      child: content ?? const SizedBox.shrink(),
    );
  }
}

/// RN `ThumbIcon` 18x18 in a 16x16 box, `powderBlue` (white once chosen);
/// the down thumb is the same icon rotated 180°.
class _Thumb extends StatelessWidget {
  const _Thumb({super.key, required this.isDown, required this.selected, required this.onTap});

  final bool isDown;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final icon = SizedBox(
      width: 18,
      height: 18,
      child: SvgPicture.asset(
        'assets/icons/thumb.svg',
        colorFilter: ColorFilter.mode(selected ? Colors.white : AppColors.powderBlue, BlendMode.srcIn),
      ),
    );
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: SizedBox(
        width: 16,
        height: 16,
        child: OverflowBox(
          maxWidth: 18,
          maxHeight: 18,
          child: isDown ? RotatedBox(quarterTurns: 2, child: icon) : icon,
        ),
      ),
    );
  }
}

/// Port of RN `ListeningScreen/components/CustomMarkdown`: `#` lines become
/// a Replay Pro Bold 16 `lightCyan` title, `- ` lines a bulleted list, any
/// other non-empty lines a paragraph (Plex 14/22, weight 300, `paleBlue`),
/// with `**bold**` spans at weight 600.
class NudgeMarkdown extends StatelessWidget {
  const NudgeMarkdown({super.key, required this.content});

  final String content;

  static final _title = RegExp(r'^(#{1,6})\s+(.+)');
  static final _listItem = RegExp(r'^-\s*(.+)');

  static const _description = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    fontWeight: FontWeight.w300,
    color: AppColors.paleBlue,
  );

  /// RN `bold` (`fontWeight: '600'`) inside a `description` Text: iOS
  /// moves IBM Plex Serif Regular to the family's closest face, Medium.
  static const _descriptionBold = TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontWeight: FontWeight.w500);

  /// The same `bold` inside a `title` (Replay Pro Bold) stays on that face.
  static const _titleBold = TextStyle(fontFamily: AppFonts.replayProBold, fontWeight: FontWeight.w600);

  /// RN `parseBoldAndText`: `**…**` pairs become weight-600 spans.
  List<InlineSpan> _inline(String line, {TextStyle bold = _descriptionBold}) {
    final parts = line.split('**');
    return [
      for (var i = 0; i < parts.length; i++)
        if (parts[i].isNotEmpty)
          TextSpan(
            text: parts[i],
            style: i.isOdd && i < parts.length - 1 ? bold : null,
          ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final children = <Widget>[];
    String? sectionType;
    final section = <String>[];

    void flush() {
      if (sectionType == null) return;
      if (sectionType == 'title') {
        children.add(
          Padding(
            padding: EdgeInsets.only(bottom: rn.s(4)),
            child: Text.rich(
              TextSpan(children: _inline(section.first, bold: _titleBold)),
              style: const TextStyle(
                fontFamily: AppFonts.replayProBold,
                fontSize: 16,
                height: 41 / 16,
                color: AppColors.lightCyan,
              ),
            ),
          ),
        );
      } else if (sectionType == 'list') {
        children.add(
          Padding(
            padding: EdgeInsets.only(bottom: rn.s(8), left: rn.s(12)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final item in section)
                  Padding(
                    padding: EdgeInsets.only(bottom: rn.s(4)),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: EdgeInsets.only(right: rn.s(6)),
                          // RN `bullet` sets no fontFamily → system font.
                          child: const Text('•', style: TextStyle(fontFamily: 'CupertinoSystemText', color: Colors.white)),
                        ),
                        Expanded(child: Text.rich(TextSpan(children: _inline(item)), style: _description)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        );
      } else {
        children.add(
          Padding(
            padding: EdgeInsets.only(bottom: rn.s(8)),
            child: Text.rich(TextSpan(children: [for (final line in section) ..._inline(line)]), style: _description),
          ),
        );
      }
      sectionType = null;
      section.clear();
    }

    for (final line in content.split('\n')) {
      final title = _title.firstMatch(line);
      final item = _listItem.firstMatch(line);
      if (title != null) {
        flush();
        sectionType = 'title';
        section.add(title.group(2)!.trim());
      } else if (item != null) {
        if (sectionType != 'list') {
          flush();
          sectionType = 'list';
        }
        section.add(item.group(1)!);
      } else if (line.trim().isNotEmpty) {
        if (sectionType != 'text') {
          flush();
          sectionType = 'text';
        }
        section.add(line);
      }
    }
    flush();

    return Padding(
      padding: EdgeInsets.only(bottom: rn.s(4)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
    );
  }
}

/// RN `SkeletonLoader`: six 8-tall `charcoalBlue` bars (100/90/70/80/90/90%
/// of 75% of the screen width), 10 apart, with a white shimmer sweeping
/// across each every 1.5 s.
class _NudgeSkeleton extends StatefulWidget {
  const _NudgeSkeleton({super.key});

  @override
  State<_NudgeSkeleton> createState() => _NudgeSkeletonState();
}

class _NudgeSkeletonState extends State<_NudgeSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final containerWidth = MediaQuery.sizeOf(context).width * 0.75;
    return Padding(
      padding: EdgeInsets.only(top: rn.vs(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final (i, pct) in const [100, 90, 70, 80, 90, 90].indexed) ...[
            if (i > 0) const SizedBox(height: 10),
            AnimatedBuilder(
              animation: _controller,
              builder: (context, _) {
                final width = containerWidth * pct / 100;
                return Container(
                  width: width,
                  height: 8,
                  decoration: BoxDecoration(color: AppColors.charcoalBlue, borderRadius: BorderRadius.circular(6)),
                  clipBehavior: Clip.antiAlias,
                  child: Transform.translate(
                    offset: Offset(-width + 2 * width * _controller.value, 0),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Container(
                        width: width * 0.7,
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(
                            colors: [Colors.transparent, Color(0x80FFFFFF), Colors.transparent],
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ],
        ],
      ),
    );
  }
}
