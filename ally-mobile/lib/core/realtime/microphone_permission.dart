import 'package:flutter/cupertino.dart';
import 'package:permission_handler/permission_handler.dart';

/// RN `react-native-permissions` `request(MICROPHONE)` collapsed to the
/// three outcomes RN's call sites branch on.
enum MicrophonePermissionResult { granted, denied, blocked }

/// Requests the microphone the way RN's `useStartSimulation` /
/// `useLiveAudioStream` do. iOS reports a previously-denied permission as
/// `permanentlyDenied` (RN `RESULTS.BLOCKED`): only Settings can grant it.
Future<MicrophonePermissionResult> requestMicrophonePermission() async {
  final status = await Permission.microphone.request();
  if (status.isGranted || status.isLimited) return MicrophonePermissionResult.granted;
  if (status.isPermanentlyDenied || status.isRestricted) return MicrophonePermissionResult.blocked;
  return MicrophonePermissionResult.denied;
}

/// RN `usePermissionAlert().showSettingsAlert` — a native `Alert.alert`
/// with a cancel button and one that opens the app's Settings page. Drawn
/// as the iOS alert RN's `Alert` is. Resolves `true` when Settings was
/// opened.
Future<bool> showPermissionSettingsAlert(
  BuildContext context, {
  required String title,
  required String message,
  required String cancelLabel,
  required String settingsLabel,
  VoidCallback? onCancel,
}) async {
  final openSettings = await showCupertinoDialog<bool>(
    context: context,
    builder: (dialogContext) => CupertinoAlertDialog(
      key: const ValueKey('permission-settings-alert'),
      title: Text(title),
      content: Text(message),
      actions: [
        // RN `style: 'cancel'`: iOS draws the cancel action bold.
        CupertinoDialogAction(
          isDefaultAction: true,
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: Text(cancelLabel),
        ),
        CupertinoDialogAction(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(settingsLabel),
        ),
      ],
    ),
  );
  if (openSettings == true) {
    await openAppSettings();
    return true;
  }
  onCancel?.call();
  return false;
}
