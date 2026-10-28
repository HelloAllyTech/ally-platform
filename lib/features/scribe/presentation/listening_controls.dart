import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';

/// Port of ally-mobile (React Native)'s `ListeningScreen/components/
/// ListeningControls` on `components/ButtonGroup/CollapsibleButtonGroup`:
/// a bar pinned to the bottom of the dark Listening screen (`darkGray3`,
/// radius 24, 21s side padding) with a chevron that collapses/expands it
/// (expanded by default — `useListeningCommon`'s
/// `isControlSectionMaximized` starts `true`). Expanded, it shows the mute
/// tooltip (when [showMuteTooltip]), then full-width 8-radius `darkGray10`
/// buttons 8s apart — pause/resume (white "active" while paused), Focus
/// (VIEW_REFERENCE_DOCUMENT only), End session (red square) — and the
/// shield + "Your data is safe" footer.
class ListeningControls extends ConsumerStatefulWidget {
  const ListeningControls({
    super.key,
    required this.isCallPaused,
    required this.onPauseResumePress,
    required this.onCallEndPress,
    this.showFocusModeButton = false,
    this.isFocusMode = false,
    this.onFocusModeButtonPress,
    this.showMuteTooltip = false,
    this.onDismissMuteTooltip,
    this.isEnding = false,
    this.showPauseResumeButton = true,
    this.showEndSessionButton = true,
    this.isPauseResumeDisabled = false,
  });

  final bool isCallPaused;
  final VoidCallback onPauseResumePress;
  final VoidCallback onCallEndPress;
  final bool showFocusModeButton;
  final bool isFocusMode;
  final VoidCallback? onFocusModeButtonPress;
  final bool showMuteTooltip;
  final VoidCallback? onDismissMuteTooltip;

  /// RN `isCallEndDisabled`.
  final bool isEnding;

  /// Both default `true` (Scribe) — `ConferenceListeningScreen` hides both,
  /// as RN does: a conference call ends only when the carrier call ends.
  final bool showPauseResumeButton;
  final bool showEndSessionButton;

  /// RN: pause is disabled for a web-microphone session (no local audio).
  final bool isPauseResumeDisabled;

  @override
  ConsumerState<ListeningControls> createState() => _ListeningControlsState();
}

class _ListeningControlsState extends ConsumerState<ListeningControls> {
  bool _isMaximized = true;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final buttons = <_ControlButton>[
      if (widget.showPauseResumeButton)
        _ControlButton(
          key: const ValueKey('pause-resume-button'),
          icon: SvgPicture.asset(
            widget.isCallPaused ? 'assets/icons/resume.svg' : 'assets/icons/pause.svg',
            width: 24,
            height: 24,
          ),
          label: ref.t(
            widget.isCallPaused ? 'listeningScreen.resumeTranscription' : 'listeningScreen.pauseTranscription',
          ),
          onPressed: widget.onPauseResumePress,
          disabled: widget.isPauseResumeDisabled,
          active: widget.isCallPaused,
        ),
      if (widget.showFocusModeButton)
        _ControlButton(
          key: const ValueKey('focus-mode-button'),
          icon: SvgPicture.asset(
            'assets/icons/mic.svg',
            colorFilter: ColorFilter.mode(widget.isFocusMode ? Colors.black : Colors.white, BlendMode.srcIn),
          ),
          label: ref.t(widget.isFocusMode ? 'listeningScreen.focused' : 'listeningScreen.focus'),
          onPressed: widget.onFocusModeButtonPress,
          active: widget.isFocusMode,
        ),
      if (widget.showEndSessionButton)
        _ControlButton(
          key: const ValueKey('end-session-button'),
          icon: Container(
            width: rn.s(16),
            height: rn.s(16),
            decoration: BoxDecoration(color: AppColors.coralRed, borderRadius: BorderRadius.circular(2)),
          ),
          label: ref.t('listeningScreen.endSession'),
          onPressed: widget.onCallEndPress,
          disabled: widget.isEnding,
        ),
    ];

    return Container(
      key: const ValueKey('listening-control-buttons'),
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 44),
      padding: EdgeInsets.only(top: rn.mvs(8), bottom: rn.mvs(6), left: rn.s(21), right: rn.s(21)),
      decoration: BoxDecoration(color: AppColors.darkGray3, borderRadius: BorderRadius.circular(24)),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            GestureDetector(
              key: const ValueKey('listening-control-buttons-toggle'),
              behavior: HitTestBehavior.opaque,
              onTap: () => setState(() => _isMaximized = !_isMaximized),
              child: Container(
                width: 48,
                height: rn.mvs(32),
                margin: EdgeInsets.only(bottom: rn.mvs(12)),
                alignment: Alignment.center,
                child: AnimatedRotation(
                  turns: _isMaximized ? 0 : 0.5,
                  duration: const Duration(milliseconds: 250),
                  child: SvgPicture.asset(
                    'assets/icons/chevronDown.svg',
                    width: 24,
                    height: 12,
                    colorFilter: const ColorFilter.mode(AppColors.lightGrayD9, BlendMode.srcIn),
                  ),
                ),
              ),
            ),
            if (_isMaximized) ...[
              if (widget.showMuteTooltip) _MuteTooltip(onDismiss: widget.onDismissMuteTooltip),
              for (var i = 0; i < buttons.length; i++) ...[
                if (i > 0) SizedBox(height: rn.s(8)),
                Padding(
                  padding: EdgeInsets.only(bottom: i == buttons.length - 1 ? rn.mvs(8) : 0),
                  child: buttons[i],
                ),
              ],
              Padding(
                padding: EdgeInsets.symmetric(vertical: rn.vs(18)),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SvgPicture.asset('assets/icons/shield.svg', width: 16, height: 16),
                    SizedBox(width: rn.s(4)),
                    Flexible(
                      child: Text(
                        ref.t('listeningScreen.dataSafe'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifMedium,
                          fontSize: 12,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// RN `ButtonItem`: full width, icon + label 10s apart, 16vs vertical
/// padding, `darkGray10` (white with `darkGray5` text when active), 50%
/// opacity when disabled.
class _ControlButton extends StatelessWidget {
  const _ControlButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.disabled = false,
    this.active = false,
  });

  final Widget icon;
  final String label;
  final VoidCallback? onPressed;
  final bool disabled;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return Opacity(
      opacity: disabled ? 0.5 : 1,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: disabled ? null : onPressed,
        child: Container(
          width: double.infinity,
          padding: EdgeInsets.symmetric(vertical: rn.vs(16)),
          decoration: BoxDecoration(
            color: active ? Colors.white : AppColors.darkGray10,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              icon,
              SizedBox(width: rn.s(10)),
              Flexible(
                child: Text(
                  label,
                  style: TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 14,
                    color: active ? AppColors.darkGray5 : Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// RN `muteTooltipContent`: a white 4-radius bubble (max 300) 32 in from
/// the left, the "Resume to let it listen" copy in Plex Regular 12/18 and a
/// 12pt close, over a small downward arrow 20 from its left edge.
class _MuteTooltip extends ConsumerWidget {
  const _MuteTooltip({this.onDismiss});

  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: EdgeInsets.only(left: 32, bottom: rn.vs(4)),
        child: Column(
          key: const ValueKey('mute-tooltip'),
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 300),
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: 12, vertical: rn.vs(8)),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(
                        ref.t('listeningScreen.muteTooltip'),
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifRegular,
                          fontSize: 12,
                          height: 18 / 12,
                          color: AppColors.highEmphasis,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    GestureDetector(
                      key: const ValueKey('mute-tooltip-close'),
                      behavior: HitTestBehavior.opaque,
                      onTap: onDismiss,
                      // close.svg has a fixed #424242 fill, so RN's color
                      // prop doesn't change it.
                      child: SvgPicture.asset('assets/icons/close.svg', width: 12, height: 12),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(left: 20),
              child: CustomPaint(size: const Size(12, 6), painter: _DownArrowPainter()),
            ),
          ],
        ),
      ),
    );
  }
}

class _DownArrowPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawPath(
      Path()
        ..moveTo(0, 0)
        ..lineTo(size.width, 0)
        ..lineTo(size.width / 2, size.height)
        ..close(),
      Paint()..color = Colors.white,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
