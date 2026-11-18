import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

/// Native helpers for the summary export on Android
/// (`MainActivity.kt`): the SDK level, the public Downloads directory
/// (RN `RNFS.DownloadDirectoryPath`) and a media-scanner pass (RN
/// `RNFS.scanFile`) so the file shows up in Files/Downloads at once.
const _fileExportChannel = MethodChannel('ally/file_export');

/// Outcome of [SummaryFileSaver.checkAndRequestPermissions].
enum StoragePermissionResult { granted, denied }

/// Ports RN `hooks/useStoragePermissions.ts` and `utils/fileOperations.ts`
/// `saveFile`, behind one injectable seam so widget tests can fake the
/// platform side.
class SummaryFileSaver {
  const SummaryFileSaver();

  /// RN `useStoragePermissions.checkAndRequestPermissions`: iOS needs
  /// nothing; Android asks for `WRITE_EXTERNAL_STORAGE` (declared with
  /// `maxSdkVersion="28"`, so only Android 9 and below have it to ask
  /// for — newer versions write to Downloads without it). A denial is the
  /// caller's cue to toast `storagePermissionDenied` and [openSettings].
  Future<StoragePermissionResult> checkAndRequestPermissions() async {
    if (!Platform.isAndroid) return StoragePermissionResult.granted;
    final sdkInt = await _fileExportChannel.invokeMethod<int>('sdkInt') ?? 0;
    if (sdkInt > 28) return StoragePermissionResult.granted;
    var status = await Permission.storage.status;
    if (status.isDenied) status = await Permission.storage.request();
    return status.isGranted ? StoragePermissionResult.granted : StoragePermissionResult.denied;
  }

  /// RN `openSettings()` after a storage denial.
  Future<void> openSettings() => openAppSettings();

  /// RN `saveFile`: `call-summary-{chatId}-{ISO timestamp, : and .
  /// replaced by ->.txt`, written as UTF-8 into `Documents/CallSummary`
  /// (iOS; created when missing, visible in the Files app through
  /// `UIFileSharingEnabled`/`LSSupportsOpeningDocumentsInPlace`) or the
  /// public Downloads directory (Android, then media-scanned). Returns the
  /// written path.
  Future<String> saveFile({required String content, required int chatId, DateTime? now}) async {
    final utc = (now ?? DateTime.now()).toUtc();
    // JS `toISOString()` precision (milliseconds); Dart would add micros.
    final iso = DateTime.utc(
      utc.year,
      utc.month,
      utc.day,
      utc.hour,
      utc.minute,
      utc.second,
      utc.millisecond,
    ).toIso8601String();
    final timestamp = iso.replaceAll(RegExp('[:.]'), '-');
    final filename = 'call-summary-$chatId-$timestamp.txt';
    final String directory;
    if (Platform.isIOS) {
      final documents = await getApplicationDocumentsDirectory();
      directory = '${documents.path}/CallSummary';
      final dir = Directory(directory);
      if (!dir.existsSync()) await dir.create(recursive: true);
    } else {
      final downloads = await _fileExportChannel.invokeMethod<String>('downloadsDir');
      if (downloads == null || downloads.isEmpty) {
        throw const FileSystemException('directoryPathError');
      }
      directory = downloads;
    }
    final filePath = '$directory/$filename';
    await File(filePath).writeAsString(content);
    if (Platform.isAndroid) {
      await _fileExportChannel.invokeMethod<void>('scanFile', {'path': filePath});
    }
    return filePath;
  }
}

final summaryFileSaverProvider = Provider<SummaryFileSaver>((ref) => const SummaryFileSaver());
