import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/app_colors.dart';

/// Port of ally-mobile (React Native)'s `src/components/Dropdown/
/// Dropdown.tsx` (`CustomDropdown`) — a closed header sized to its OWN
/// content (`alignSelf: 'flex-start'`, the header `Text` just wraps
/// `value`), not to the widest possible option, with a floating menu
/// (not an inline expand) that's wide enough for the longest option
/// (`Math.ceil(longestOptionWidth + 36)`), right-aligned to the header's
/// right edge when [alignRight] is set, and the selected item shown in
/// [selectedItemStyle].
///
/// Extracted from `LeaderboardScreen`'s own `_PeriodDropdown` (which keeps
/// using it directly since RN gives it a `fixedWidth`), generalized for
/// `ReviewScreen`'s sort dropdown, which RN gives no `fixedWidth` —
/// its header must size to the current selection only. The app's other
/// dropdown widget, `AppDropdown` (wrapping Material's `DropdownMenu`),
/// can't do this: `DropdownMenu` always sizes its closed field to the
/// WIDEST possible entry, which is what made `ReviewScreen`'s sort filter
/// render oversized (as wide as "Most commented") even when "Latest" was
/// selected — confirmed exactly matching the gap already documented on
/// `LeaderboardScreen`'s own replacement of `AppDropdown` for this same
/// reason ("it clipped 'Last 7 days'").
class CustomDropdown extends StatefulWidget {
  const CustomDropdown({
    super.key,
    required this.value,
    required this.options,
    required this.onSelect,
    required this.headerTextStyle,
    required this.itemTextStyle,
    this.headerDecoration,
    this.headerPadding = const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
    this.fixedWidth,
    this.alignRight = true,
    this.arrowSize = 6,
    this.menuKey,
  });

  final String value;
  final List<String> options;
  final ValueChanged<String> onSelect;
  final TextStyle headerTextStyle;
  final TextStyle itemTextStyle;
  final BoxDecoration? headerDecoration;
  final EdgeInsets headerPadding;

  /// RN's `fixedWidth` prop — when null, the header sizes to [value]'s own
  /// content (RN's `alignSelf: 'flex-start'` default), not a fixed box.
  final double? fixedWidth;
  final bool alignRight;
  final double arrowSize;

  /// Key applied to the opened menu's container — used by callers' widget
  /// tests to assert the menu actually opened.
  final Key? menuKey;

  @override
  State<CustomDropdown> createState() => _CustomDropdownState();
}

class _CustomDropdownState extends State<CustomDropdown> {
  bool _isOpen = false;

  Future<void> _open() async {
    final box = context.findRenderObject()! as RenderBox;
    final topLeft = box.localToGlobal(Offset.zero);
    final rect = topLeft & box.size;
    final screenWidth = MediaQuery.sizeOf(context).width;
    final textScaler = MediaQuery.textScalerOf(context);
    final longest = widget.options.fold('', (a, b) => a.length >= b.length ? a : b);
    final painter = TextPainter(
      text: TextSpan(text: longest, style: widget.itemTextStyle),
      textDirection: TextDirection.ltr,
      textScaler: textScaler,
    )..layout();
    final minWidth = (painter.width + 36).ceilToDouble();
    painter.dispose();

    setState(() => _isOpen = true);
    final selected = await showGeneralDialog<String>(
      context: context,
      barrierDismissible: true,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      barrierColor: Colors.transparent,
      transitionDuration: Duration.zero,
      pageBuilder: (dialogContext, _, _) => Stack(
        children: [
          Positioned(
            top: rect.bottom - 2,
            left: widget.alignRight ? null : rect.left,
            right: widget.alignRight ? screenWidth - rect.right : null,
            child: Container(
              key: widget.menuKey,
              constraints: BoxConstraints(
                minWidth: minWidth > rect.width ? minWidth : rect.width,
                maxHeight: (widget.options.length * 40).clamp(0, 200).toDouble(),
              ),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.lightGray7),
                boxShadow: const [BoxShadow(color: Color(0x33000000), offset: Offset(0, 2), blurRadius: 4)],
              ),
              child: Material(
                type: MaterialType.transparency,
                child: SingleChildScrollView(
                  child: IntrinsicWidth(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final option in widget.options)
                          GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onTap: () => Navigator.of(dialogContext).pop(option),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                              child: Text(
                                option,
                                style: option == widget.value
                                    ? widget.itemTextStyle.copyWith(
                                        color: AppColors.primary,
                                        fontWeight: FontWeight.w500,
                                      )
                                    : widget.itemTextStyle,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
    if (!mounted) return;
    setState(() => _isOpen = false);
    if (selected != null) widget.onSelect(selected);
  }

  @override
  Widget build(BuildContext context) {
    final header = Container(
      width: widget.fixedWidth,
      padding: widget.headerPadding,
      decoration: widget.headerDecoration ??
          const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.all(Radius.circular(4))),
      child: Row(
        mainAxisSize: widget.fixedWidth == null ? MainAxisSize.min : MainAxisSize.max,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(child: Text(widget.value, style: widget.headerTextStyle)),
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: RotatedBox(
              quarterTurns: _isOpen ? 2 : 0,
              child: SizedBox(
                width: widget.arrowSize,
                height: widget.arrowSize,
                child: SvgPicture.asset(
                  'assets/icons/arrowDown.svg',
                ),
              ),
            ),
          ),
        ],
      ),
    );

    return GestureDetector(behavior: HitTestBehavior.opaque, onTap: _open, child: header);
  }
}
