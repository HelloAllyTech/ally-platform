import 'package:flutter/foundation.dart';

import '../../network/error_details.dart';

/// RN `components/Toast/toastBridge.ts` `ToastType`.
enum ToastType { success, error }

/// RN `ToastPosition`. Every RN call site uses the default, [bottom].
enum ToastPosition { top, bottom }

/// One toast as RN's `ToastProvider` holds it in `toastState`.
@immutable
class ToastData {
  const ToastData({
    required this.id,
    required this.message,
    required this.type,
    required this.duration,
    required this.position,
  });

  /// Bumped on every [ToastController.show], so a replacement can be told
  /// apart from the toast it replaced.
  final int id;
  final String message;
  final ToastType type;
  final Duration duration;
  final ToastPosition position;
}

/// RN `ToastProvider`'s state + `toastBridge`'s imperative handlers, with no
/// `BuildContext` needed: callable from widgets, controllers and the
/// network layer alike. `ToastHost` (mounted once in `main.dart`) renders
/// [current] and runs its timer, as RN's `Toast` component does.
///
/// One toast at a time, as in RN: a new [show] replaces the visible one's
/// text and restarts the timer (RN re-runs the Toast's effect without
/// remounting it, so there is no second entrance animation). When the
/// timer fires the toast is removed and its `onHide` runs.
///
/// Like RN's bridge, [show] is a no-op while no host is mounted.
class ToastController extends ChangeNotifier {
  ToastData? _current;
  VoidCallback? _onHide;
  int _nextId = 0;
  int _hosts = 0;

  ToastData? get current => _current;

  /// RN `showToast(options | message, type)`. RN's default type is
  /// `success` (some RN failure toasts rely on that default, and so look
  /// green), duration 3000ms, position bottom.
  void show(
    String message, {
    ToastType type = ToastType.success,
    Duration duration = const Duration(milliseconds: 3000),
    ToastPosition position = ToastPosition.bottom,
    VoidCallback? onHide,
  }) {
    if (_hosts == 0) return;
    _current = ToastData(
      id: _nextId++,
      message: message,
      type: type,
      duration: duration,
      position: position,
    );
    _onHide = onHide;
    notifyListeners();
  }

  /// RN `hideToast`: hides without calling `onHide`.
  void hide() {
    _onHide = null;
    if (_current == null) return;
    _current = null;
    notifyListeners();
  }

  /// The host's timer for toast [id] fired: remove it and run its `onHide`
  /// (ignored if a newer toast replaced it meanwhile).
  void expire(int id) {
    if (_current?.id != id) return;
    final onHide = _onHide;
    _onHide = null;
    _current = null;
    notifyListeners();
    onHide?.call();
  }

  /// Called by `ToastHost` on mount / unmount.
  void attachHost() => _hosts++;

  void detachHost() {
    _hosts--;
    if (_hosts <= 0) {
      _hosts = 0;
      _current = null;
      _onHide = null;
    }
  }
}

/// The app's single toast controller (RN's module-level `toastBridge`).
final toastController = ToastController();

/// RN `showToast(message, type)`.
void showToast(
  String message, {
  ToastType type = ToastType.success,
  Duration duration = const Duration(milliseconds: 3000),
  ToastPosition position = ToastPosition.bottom,
  VoidCallback? onHide,
}) =>
    toastController.show(message, type: type, duration: duration, position: position, onHide: onHide);

/// `showToast(message, 'success')`.
void showSuccessToast(String message) => showToast(message, type: ToastType.success);

/// `showToast(message, 'error')`, e.g. `showToast(getErrorDetails(err).message, 'error')`.
void showErrorMessageToast(String message) => showToast(message, type: ToastType.error);

/// RN `hideToast`.
void hideToast() => toastController.hide();

/// RN `useErrorToast().showErrorToast(error, fallbackKey)`: an error toast
/// reading "`t(fallbackKey)`: `getErrorDetails(error).message`".
///
/// Ported as written: `getErrorDetails` always yields a message (the
/// backend's, else `common.somethingWentWrong`), which never equals RN's
/// `postCallSummary.somethingWentWrongRetry`, so the "reason" suffix is
/// always added — a network failure reads "Failed to start simulation:
/// Something went wrong!".
void showErrorToast(Object? error, String fallbackKey, {String Function(String key)? t}) {
  final translate = t ?? errorTranslator;
  final details = getErrorDetails(error, t: translate);
  final fallbackMessage = translate(fallbackKey);
  final defaultFallback = translate('postCallSummary.somethingWentWrongRetry');
  final hasApiError = details.status != null && details.message != translate(somethingWentWrongKey);
  final hasSpecificError =
      hasApiError || (details.message.trim().isNotEmpty && details.message != defaultFallback);
  showToast(
    hasSpecificError ? '$fallbackMessage: ${details.message}' : fallbackMessage,
    type: ToastType.error,
  );
}
