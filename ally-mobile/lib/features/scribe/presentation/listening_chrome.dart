import 'dart:math' as math;

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';

/// Shared chrome of ally-mobile (React Native)'s two Listening screens
/// (`screens/ListeningScreen/styles.ts`, `MicrophoneListeningScreen.tsx`,
/// `ConferenceListeningScreen.tsx`): the full-bleed `darkGray7` page with a
/// translucent light-content status bar and no header, the "Connecting…"
/// view, and the lock + "Taking notes" row with its privacy tooltip.

/// RN `styles.container` + `<StatusBar translucent barStyle="light-content">`.
class ListeningPage extends StatelessWidget {
  const ListeningPage({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(backgroundColor: AppColors.darkGray7, body: child),
    );
  }
}

/// RN's `!chatData?.chatId` view: the iOS large activity indicator, the
/// "Connecting…" line (Plex Medium 14, white, 10vs below) and — Scribe only
/// — an underlined Cancel that leaves the screen (RN `connecting-cancel`).
class ListeningConnectingView extends ConsumerWidget {
  const ListeningConnectingView({super.key, this.onCancel});

  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    const textStyle = TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 14, color: Colors.white);
    return Center(
      key: const ValueKey('listening-connecting'),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // RN `ActivityIndicator size="large"` (the 37pt iOS spinner).
          const CupertinoActivityIndicator(radius: 18, color: Colors.white),
          SizedBox(height: rn.vs(10)),
          Text(ref.t('listeningScreen.connecting'), style: textStyle),
          if (onCancel != null)
            GestureDetector(
              key: const ValueKey('connecting-cancel'),
              behavior: HitTestBehavior.opaque,
              onTap: onCancel,
              child: Padding(
                padding: EdgeInsets.only(top: rn.vs(24)),
                child: Padding(
                  padding: EdgeInsets.symmetric(vertical: rn.vs(10), horizontal: rn.s(24)),
                  child: Text(
                    ref.t('common.cancel'),
                    style: textStyle.copyWith(decoration: TextDecoration.underline, decorationColor: Colors.white),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// RN `renderTakingNotes`: the 16pt lock (`lightGrayD9`) — which opens the
/// privacy tooltip, and only in focus mode (`disabled={!isFocusMode}`) —
/// then "Taking notes" in Plex Medium 14, 8s apart, 8vs below.
class TakingNotesRow extends ConsumerStatefulWidget {
  const TakingNotesRow({super.key, required this.isFocusMode});

  final bool isFocusMode;

  @override
  ConsumerState<TakingNotesRow> createState() => _TakingNotesRowState();
}

class _TakingNotesRowState extends ConsumerState<TakingNotesRow> {
  final _lockKey = GlobalKey();

  void _openTooltip() {
    // `useListeningScreen.tooltipContentList`.
    final items = [
      ref.t('audioCall.privacy.noRecording'),
      ref.t('audioCall.privacy.encrypted'),
      ref.t('audioCall.privacy.noTrainingData'),
      ref.t('audioCall.privacy.personalInfoRemoved'),
    ];
    showPrivacyTooltip(context, anchorKey: _lockKey, items: items, horizontalInset: widget.isFocusMode ? 40 : 10);
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: rn.vs(8)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          GestureDetector(
            key: const ValueKey('privacy-lock'),
            behavior: HitTestBehavior.opaque,
            onTap: widget.isFocusMode ? _openTooltip : null,
            child: SizedBox(
              width: 16,
              height: 16,
              child: SvgPicture.asset(
                'assets/icons/lock.svg',
                key: _lockKey,
                colorFilter: const ColorFilter.mode(AppColors.lightGrayD9, BlendMode.srcIn),
              ),
            ),
          ),
          SizedBox(width: rn.s(8)),
          Text(
            ref.t('listeningScreen.takingNotes'),
            style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifMedium, fontSize: 14, color: Colors.white),
          ),
        ],
      ),
    );
  }
}

/// RN `components/PrivacyTooltip` (react-native-walkthrough-tooltip,
/// placement top): a 50% black backdrop that closes on tap, and a white
/// 4-radius bubble above the lock with a downward arrow, kept [horizontalInset]
/// from the screen edges (`tooltipDisplayInsets`). The bullets are system
/// font 14/20 black (`styles.tooltipText` sets no font family), min 250 x 120.
/// A caller with its own `tooltipContent` (e.g. the call-summary
/// AddNotesSection) passes [content] instead of [items].
Future<void> showPrivacyTooltip(
  BuildContext context, {
  required GlobalKey anchorKey,
  List<String> items = const [],
  Widget? content,
  double horizontalInset = 40,
}) {
  final navigatorContext = Navigator.of(context).context;
  final anchorBox = anchorKey.currentContext?.findRenderObject() as RenderBox?;
  final overlayBox = navigatorContext.findRenderObject() as RenderBox?;
  if (anchorBox == null || overlayBox == null) return Future.value();
  final anchor = anchorBox.localToGlobal(Offset.zero, ancestor: overlayBox) & anchorBox.size;
  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'privacy-tooltip',
    barrierColor: const Color(0x80000000),
    transitionDuration: const Duration(milliseconds: 150),
    pageBuilder: (dialogContext, _, _) => CustomSingleChildLayout(
      delegate: _AboveAnchorLayout(anchor: anchor, inset: horizontalInset),
      child: _PrivacyTooltipBubble(items: items, content: content, arrowX: anchor.center.dx),
    ),
  );
}

class _AboveAnchorLayout extends SingleChildLayoutDelegate {
  _AboveAnchorLayout({required this.anchor, required this.inset});

  final Rect anchor;
  final double inset;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) =>
      BoxConstraints(maxWidth: math.max(0, constraints.maxWidth - inset * 2));

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final left = (anchor.center.dx - childSize.width / 2).clamp(inset, math.max(inset, size.width - inset - childSize.width)).toDouble();
    return Offset(left, anchor.top - childSize.height);
  }

  @override
  bool shouldRelayout(_AboveAnchorLayout oldDelegate) => oldDelegate.anchor != anchor || oldDelegate.inset != inset;
}

class _PrivacyTooltipBubble extends StatelessWidget {
  const _PrivacyTooltipBubble({required this.items, required this.arrowX, this.content});

  final List<String> items;
  final Widget? content;
  final double arrowX;

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: Column(
        key: const ValueKey('privacy-tooltip'),
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            constraints: content == null ? const BoxConstraints(minWidth: 250, minHeight: 120) : null,
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 10),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)),
            child: content ?? Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final item in items)
                  Text(
                    '• $item',
                    style: const TextStyle(
                      fontFamily: 'CupertinoSystemText',
                      fontSize: 14,
                      height: 20 / 14,
                      color: Colors.black,
                    ),
                  ),
              ],
            ),
          ),
          CustomPaint(size: const Size(16, 8), painter: _ArrowPainter()),
        ],
      ),
    );
  }
}

class _ArrowPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
