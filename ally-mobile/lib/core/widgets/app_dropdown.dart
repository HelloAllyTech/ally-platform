import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Port of ally-mobile (React Native)'s `src/components/Dropdown/
/// Dropdown.tsx` (`CustomDropdown`) — a rounded-rect closed header with a
/// chevron that flips on open, expanding into a floating bordered menu
/// (not an inline expand). Flutter's own overlay/menu primitives
/// (`DropdownMenu`) already implement this exact interaction shape, so
/// this wraps one instead of hand-rolling the `Modal` + `measureInWindow`
/// positioning the RN source uses — same visible behavior, idiomatic
/// Flutter underneath.
///
/// Matches the RN source's one clear bit of visual state: the selected
/// item's text renders in the brand primary color + medium weight, with
/// no checkmark icon or background highlight otherwise.
class AppDropdown extends StatelessWidget {
  const AppDropdown({
    super.key,
    required this.value,
    required this.options,
    required this.onSelect,
    this.placeholder = 'Select',
    this.enabled = true,
  });

  final String? value;
  final List<String> options;
  final ValueChanged<String> onSelect;
  final String placeholder;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: DropdownMenu<String>(
        enabled: enabled,
        initialSelection: value,
        hintText: placeholder,
        menuHeight: 200,
        textStyle: const TextStyle(fontFamily: 'IBMPlexSerif-Regular', color: AppColors.highEmphasis),
        inputDecorationTheme: const InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(4))),
        ),
        menuStyle: MenuStyle(
          backgroundColor: const WidgetStatePropertyAll(Colors.white),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
              side: const BorderSide(color: AppColors.lightGray7),
            ),
          ),
        ),
        onSelected: (selected) {
          if (selected != null) onSelect(selected);
        },
        dropdownMenuEntries: [
          for (final option in options)
            DropdownMenuEntry(
              value: option,
              label: option,
              style: option == value
                  ? MenuItemButton.styleFrom(foregroundColor: AppColors.primary)
                  : null,
            ),
        ],
      ),
    );
  }
}
