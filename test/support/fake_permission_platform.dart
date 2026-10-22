import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

/// Minimal fake for permission_handler's platform-interface seam.
///
/// permission_handler has no `setMockInitialValues`-style helper the way
/// shared_preferences does, but it does expose exactly the kind of
/// test seam that's supposed to be faked: `PermissionHandlerPlatform` is a
/// `PlatformInterface` meant to be swapped out, same mechanism real platform
/// packages (Android/iOS/web) register themselves through. This fake
/// implements only the two methods permission_handler's `.request()`/
/// `.status` getters actually funnel through — nothing from LiveKit/
/// socket_io_client/flutter_foreground_task is faked this way, since those
/// don't expose an equivalent, swappable interface for what this app
/// actually calls (see the NOTE comments in the screen test files that use
/// this).
///
/// Install with:
/// ```dart
/// PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({
///   Permission.microphone: PermissionStatus.denied,
/// });
/// ```
/// Any permission not present in [statuses] reports as granted.
class FakePermissionHandlerPlatform extends PermissionHandlerPlatform {
  FakePermissionHandlerPlatform(this.statuses);

  final Map<Permission, PermissionStatus> statuses;

  @override
  Future<Map<Permission, PermissionStatus>> requestPermissions(
    List<Permission> permissions,
  ) async {
    return {
      for (final permission in permissions)
        permission: statuses[permission] ?? PermissionStatus.granted,
    };
  }

  @override
  Future<PermissionStatus> checkPermissionStatus(Permission permission) async {
    return statuses[permission] ?? PermissionStatus.granted;
  }

  /// Not a real settings-app launch — just records that it was asked for,
  /// so a "denied -> tap Open Settings" test can assert on [openedSettings]
  /// without the base platform interface's `UnimplementedError`.
  bool openedSettings = false;

  @override
  Future<bool> openAppSettings() async {
    openedSettings = true;
    return true;
  }
}
