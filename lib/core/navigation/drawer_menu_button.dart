import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../localization/translate_ref.dart';

/// RN's `useTabScreenHeader` (`showHamburger: isFirstTab`): tells a tab
/// screen's own header whether it should carry the drawer-menu button.
/// `AppShellScreen` wraps each tab body in one; anything outside the shell
/// (pushed routes, tests) has none and so never shows the button.
///
/// The shell used to paint the button in a `Positioned` layer over the tab
/// instead, which landed on top of the header title ("Ally Learn" read as
/// struck through) — RN renders it inside the header's left group, so the
/// title is laid out after it.
class DrawerMenuScope extends InheritedWidget {
  const DrawerMenuScope({
    super.key,
    required this.onOpenDrawer,
    required super.child,
  });

  /// Opens the shell's drawer; null on every tab but the first. Carried
  /// here rather than looked up with `Scaffold.of` from the button, because
  /// each tab screen has its own drawer-less `Scaffold`, and that inner one
  /// is the nearest.
  final VoidCallback? onOpenDrawer;

  static VoidCallback? openDrawerOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<DrawerMenuScope>()?.onOpenDrawer;

  static bool showsMenu(BuildContext context) => openDrawerOf(context) != null;

  @override
  bool updateShouldNotify(DrawerMenuScope oldWidget) => onOpenDrawer != oldWidget.onOpenDrawer;
}

/// RN's `TabScreenHeader` hamburger: opens the shell's side drawer.
class DrawerMenuButton extends ConsumerWidget {
  const DrawerMenuButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return IconButton(
      key: const Key('drawer-menu-button'),
      tooltip: ref.t('accessibility.openMenu'),
      padding: const EdgeInsets.all(4),
      constraints: const BoxConstraints(),
      // RN renders this SVG at its intrinsic 16x12 (react-native-svg's
      // default), not 24x24.
      icon: SvgPicture.asset('assets/icons/drawerMenu.svg'),
      onPressed: DrawerMenuScope.openDrawerOf(context),
    );
  }
}
