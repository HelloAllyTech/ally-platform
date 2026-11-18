import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';

/// RN's `CustomDropdown` (`src/components/Dropdown/Dropdown.tsx`) as the
/// role-play screens use it for the language picker: a borderless white
/// header — the label in `fieldValueText` (IBM Plex Serif 14, medium
/// emphasis) and a 6px down-triangle that flips while open — dropping a
/// rounded, bordered list just below it with the current option in primary.
///
/// The shared `AppDropdown` is an outlined text-field style menu, which is
/// not what these screens show, hence this local port.
class ScenarioLanguageDropdown<T> extends StatefulWidget {
  const ScenarioLanguageDropdown({
    super.key,
    required this.options,
    required this.selected,
    required this.labelOf,
    required this.onSelected,
    this.enabled = true,
    this.placeholder = 'Select',
  });

  final List<T> options;
  final T? selected;
  final String Function(T option) labelOf;
  final ValueChanged<T> onSelected;
  final bool enabled;
  final String placeholder;

  @override
  State<ScenarioLanguageDropdown<T>> createState() =>
      _ScenarioLanguageDropdownState<T>();
}

class _ScenarioLanguageDropdownState<T>
    extends State<ScenarioLanguageDropdown<T>> {
  bool _isOpen = false;

  // commonStyles.fieldValueText / styles.itemText (same size, different colour).
  static const _valueStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );

  Future<void> _open() async {
    final box = context.findRenderObject() as RenderBox?;
    final overlay =
        Overlay.of(context).context.findRenderObject() as RenderBox?;
    if (box == null || overlay == null) return;
    final topLeft = box.localToGlobal(Offset.zero, ancestor: overlay);
    // RN: top = header bottom - 2, left-aligned with the header.
    final top = topLeft.dy + box.size.height - 2;
    final position = RelativeRect.fromLTRB(
      topLeft.dx,
      top,
      overlay.size.width - topLeft.dx,
      overlay.size.height - top,
    );

    setState(() => _isOpen = true);
    final picked = await showMenu<T>(
      context: context,
      position: position,
      color: Colors.white,
      elevation: 5,
      shadowColor: Colors.black,
      menuPadding: EdgeInsets.zero,
      constraints: BoxConstraints(minWidth: box.size.width, maxHeight: 200),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.lightGray7),
      ),
      items: [
        for (final option in widget.options)
          PopupMenuItem<T>(
            value: option,
            height: 0,
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
            child: Text(
              widget.labelOf(option),
              // RN `selectedItem`: weight 500 on IBM Plex Serif Regular
              // resolves to the Medium face on iOS.
              style: _valueStyle.copyWith(
                color: option == widget.selected
                    ? AppColors.primary
                    : AppColors.highEmphasis,
                fontFamily: option == widget.selected
                    ? AppFonts.ibmPlexSerifMedium
                    : AppFonts.ibmPlexSerifRegular,
                fontWeight: option == widget.selected
                    ? FontWeight.w500
                    : FontWeight.w400,
              ),
            ),
          ),
      ],
    );
    if (!mounted) return;
    setState(() => _isOpen = false);
    if (picked != null) widget.onSelected(picked);
  }

  @override
  Widget build(BuildContext context) {
    final selected = widget.selected;
    final label = selected == null ? '' : widget.labelOf(selected);

    // Sized to its content (RN: alignSelf flex-start); callers in a
    // stretching column wrap it in an Align.
    return Opacity(
      opacity: widget.enabled ? 1 : 0.5,
      child: GestureDetector(
        key: const Key('scenario-language-dropdown'),
        behavior: HitTestBehavior.opaque,
        onTap: widget.enabled ? _open : null,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(4),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label.isEmpty ? widget.placeholder : label,
                style: label.isEmpty
                    ? _valueStyle.copyWith(
                        color: AppColors.charcoal2.withValues(alpha: 0.5),
                      )
                    : _valueStyle,
              ),
              const SizedBox(width: 8),
              RotatedBox(
                quarterTurns: _isOpen ? 2 : 0,
                child: SizedBox(
                  width: 6,
                  height: 6,
                  child: SvgPicture.asset(
                    'assets/icons/arrowDown.svg',
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
