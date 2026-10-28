import 'package:flutter/widgets.dart';

/// React Navigation's `useFocusEffect` for this app: calls [onFocus] each
/// time the screen becomes the one the user is looking at again — its tab
/// is selected in the shell's `IndexedStack` (`Visibility.of`), and no
/// page is pushed over it (`ModalRoute.isCurrent`).
///
/// Popups (dropdown menus, dialogs, bottom sheets) don't count: in RN those
/// are `Modal`s that never blur the screen. A page pushed on top is told
/// apart from a popup by the route's secondary animation, which only a
/// page-to-page transition drives.
///
/// The first focus (the initial mount) is skipped: the screen's providers
/// fetch on first watch anyway, which is what RN's first focus does too.
class ScreenFocusListener extends StatefulWidget {
  const ScreenFocusListener({super.key, required this.onFocus, required this.child});

  /// Runs after the frame, so it may invalidate providers.
  final VoidCallback onFocus;
  final Widget child;

  @override
  State<ScreenFocusListener> createState() => _ScreenFocusListenerState();
}

class _ScreenFocusListenerState extends State<ScreenFocusListener> {
  bool? _wasFocused;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    final coveredByPage = route != null &&
        !route.isCurrent &&
        (route.secondaryAnimation?.status ?? AnimationStatus.dismissed) != AnimationStatus.dismissed;
    final focused = Visibility.of(context) && !coveredByPage;
    final regained = _wasFocused == false && focused;
    _wasFocused = focused;
    if (regained) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.onFocus();
      });
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
