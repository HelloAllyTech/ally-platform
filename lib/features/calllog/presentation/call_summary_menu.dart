import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';

/// RN text with no `fontFamily` renders in the iOS system font.
const _systemFont = 'CupertinoSystemText';

/// One row of [CallSummaryMenu] (RN `CustomMenuModalOption`).
class CallSummaryMenuOption {
  const CallSummaryMenuOption({required this.label, required this.iconAsset, required this.onPress, this.key});

  final String label;

  /// RN `iconRight`, always drawn 16x16.
  final String iconAsset;
  final VoidCallback onPress;
  final Key? key;
}

/// Port of RN `CallSummaryScreen/components/CustomMenuModal` — the 3-dot
/// menu: a faint white overlay and a 200-wide white card pinned under the
/// header (`insets.top + 60`, 20 from the right) that fades and slides 10px
/// down in 200ms. Each row is IBM Plex Serif 15 black text with a 16x16 icon
/// on the right, separated by 0.5 lightGray2 hairlines inset by 10.
class CallSummaryMenu extends StatelessWidget {
  const CallSummaryMenu({super.key, required this.options, required this.animation});

  final List<CallSummaryMenuOption> options;
  final Animation<double> animation;

  /// Shows the menu; resolves once it closes (overlay tap, back, or an
  /// option, which pops the menu before running its action).
  static Future<void> show(BuildContext context, List<CallSummaryMenuOption> options) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      barrierColor: AppColors.whiteTransparent10,
      transitionDuration: const Duration(milliseconds: 200),
      pageBuilder: (dialogContext, animation, _) => CallSummaryMenu(
        animation: animation,
        options: [
          for (final option in options)
            CallSummaryMenuOption(
              key: option.key,
              label: option.label,
              iconAsset: option.iconAsset,
              onPress: () {
                Navigator.of(dialogContext).pop();
                option.onPress();
              },
            ),
        ],
      ),
      transitionBuilder: (_, animation, _, child) => child,
    );
  }

  @override
  Widget build(BuildContext context) {
    final insets = MediaQuery.paddingOf(context);
    // RN: `width: min(200, 70% of screen)` with `minWidth: 200` — always 200.
    const width = 200.0;
    final children = <Widget>[];
    for (var i = 0; i < options.length; i++) {
      final option = options[i];
      children.add(
        InkWell(
          key: option.key,
          onTap: option.onPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 20),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      option.label,
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifRegular,
                        fontSize: 15,
                        color: Colors.black,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: SvgPicture.asset(option.iconAsset),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      if (i < options.length - 1) {
        children.add(
          Container(height: 0.5, margin: const EdgeInsets.symmetric(horizontal: 10), color: AppColors.lightGray2),
        );
      }
    }
    return Stack(
      children: [
        Positioned(
          top: insets.top + 60,
          right: 20,
          width: width,
          child: FadeTransition(
            opacity: animation,
            child: AnimatedBuilder(
              animation: animation,
              builder: (context, child) =>
                  Transform.translate(offset: Offset(0, -10 * (1 - animation.value)), child: child),
              child: Material(
                color: Colors.white,
                borderRadius: BorderRadius.circular(8),
                elevation: 0,
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(8),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.darkGray.withValues(alpha: 0.2),
                        offset: const Offset(0, 2),
                        blurRadius: 8,
                      ),
                    ],
                    color: Colors.white,
                  ),
                  child: Column(mainAxisSize: MainAxisSize.min, children: children),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Port of RN `components/CustomModal` as `DeleteRenameModal` uses it: a
/// centered white card (radius 12, min 280 / max 80% wide) on a
/// rgba(19,19,19,.37) scrim with a bold system-font title, an optional
/// grey input (rename) or description (delete), and a Cancel | primary
/// button row split by 1px lightGray8 rules.
class CallSummaryTextModal extends StatefulWidget {
  const CallSummaryTextModal({
    super.key,
    required this.title,
    required this.primaryLabel,
    required this.secondaryLabel,
    this.primaryTextColor = AppColors.blue,
    this.initialValue,
    this.showInput = false,
    this.description,
  });

  final String title;
  final String primaryLabel;
  final String secondaryLabel;
  final Color primaryTextColor;
  final String? initialValue;
  final bool showInput;
  final String? description;

  /// Resolves to the input text (rename) or `''` (delete) on the primary
  /// button, `null` on Cancel.
  static Future<String?> show(
    BuildContext context, {
    required String title,
    required String primaryLabel,
    required String secondaryLabel,
    Color primaryTextColor = AppColors.blue,
    String? initialValue,
    bool showInput = false,
    String? description,
  }) {
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      barrierColor: AppColors.modalOverlay,
      builder: (_) => CallSummaryTextModal(
        title: title,
        primaryLabel: primaryLabel,
        secondaryLabel: secondaryLabel,
        primaryTextColor: primaryTextColor,
        initialValue: initialValue,
        showInput: showInput,
        description: description,
      ),
    );
  }

  @override
  State<CallSummaryTextModal> createState() => _CallSummaryTextModalState();
}

class _CallSummaryTextModalState extends State<CallSummaryTextModal> {
  late final TextEditingController _controller = TextEditingController(text: widget.initialValue ?? '');
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final screenWidth = MediaQuery.sizeOf(context).width;
    const buttonText = TextStyle(fontFamily: _systemFont, fontSize: 14, fontWeight: FontWeight.w500);
    return Dialog(
      backgroundColor: Colors.white,
      elevation: 0,
      insetPadding: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ConstrainedBox(
        constraints: BoxConstraints(minWidth: 280, maxWidth: screenWidth * 0.8),
        child: IntrinsicWidth(
          child: Padding(
            padding: EdgeInsets.only(top: rn.mvs(20)),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: EdgeInsets.only(bottom: rn.mvs(10)),
                  child: Text(
                    widget.title,
                    textAlign: TextAlign.center,
                    // typography.body.large, weight 600, system font.
                    style: const TextStyle(
                      fontFamily: _systemFont,
                      fontSize: 16,
                      height: 24 / 16,
                      letterSpacing: 0.5,
                      fontWeight: FontWeight.w600,
                      color: Colors.black,
                    ),
                  ),
                ),
                if (widget.showInput)
                  Padding(
                    padding: EdgeInsets.only(left: 20, right: 20, bottom: rn.vs(24)),
                    child: TextField(
                      key: const Key('call-summary-modal-input'),
                      controller: _controller,
                      focusNode: _focusNode,
                      style: TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        fontSize: rn.s(16),
                        color: AppColors.charcoal2,
                      ),
                      decoration: InputDecoration(
                        isDense: true,
                        filled: true,
                        fillColor: AppColors.lightGray,
                        contentPadding: EdgeInsets.all(rn.s(12)),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(rn.s(8)),
                          borderSide: const BorderSide(color: AppColors.lightGray2),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(rn.s(8)),
                          borderSide: const BorderSide(color: AppColors.brightBlue),
                        ),
                      ),
                    ),
                  ),
                if (widget.description != null && widget.description!.isNotEmpty)
                  Padding(
                    padding: EdgeInsets.only(left: 16, right: 16, bottom: rn.mvs(16)),
                    child: Text(
                      widget.description!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifRegular,
                        fontSize: 14,
                        height: 22 / 14,
                        letterSpacing: 0.2,
                        color: AppColors.charcoal2,
                      ),
                    ),
                  ),
                Container(
                  decoration: const BoxDecoration(
                    border: Border(top: BorderSide(color: AppColors.lightGray8)),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: InkWell(
                          key: const Key('call-summary-modal-secondary'),
                          onTap: () => Navigator.of(context).pop(),
                          child: Container(
                            padding: EdgeInsets.symmetric(vertical: rn.mvs(14), horizontal: 14),
                            decoration: const BoxDecoration(
                              border: Border(right: BorderSide(color: AppColors.lightGray8)),
                            ),
                            alignment: Alignment.center,
                            child: Text(widget.secondaryLabel, style: buttonText.copyWith(color: Colors.black)),
                          ),
                        ),
                      ),
                      Expanded(
                        child: InkWell(
                          key: const Key('call-summary-modal-primary'),
                          onTap: () => Navigator.of(context).pop(widget.showInput ? _controller.text : ''),
                          child: Padding(
                            padding: EdgeInsets.symmetric(vertical: rn.mvs(12), horizontal: 14),
                            child: Center(
                              child: Text(
                                widget.primaryLabel,
                                style: buttonText.copyWith(color: widget.primaryTextColor),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
