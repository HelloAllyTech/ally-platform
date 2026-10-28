import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/root_scaffold_messenger.dart';
import '../data/call_log_repository.dart';
import '../data/summary_file_export.dart';

/// RN `useToast().showToast` — this app's toasts are root snackbars.
void showCallSummaryToast(String message) {
  rootScaffoldMessengerKey.currentState?.showSnackBar(SnackBar(content: Text(message)));
}

/// RN `useErrorToast().showErrorToast(error, fallbackKey)`: an API error
/// with a `message`/`error` body reads "{fallback}: {reason}"; anything
/// else is the fallback alone.
String callSummaryErrorMessage(Object error, String fallback) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map) {
      final reason = data['message'] ?? data['error'];
      final text = reason is List ? reason.join(', ') : reason?.toString();
      if (text != null && text.trim().isNotEmpty) return '$fallback: $text';
    }
  }
  return fallback;
}

/// Port of RN `hooks/useCallSummaryActions.ts`' server actions — rename,
/// export, archive/unarchive and delete — each with RN's toasts. Kept out
/// of the screen widget so the 3-dot menu's behaviour is testable on its
/// own.
class CallSummaryActions {
  CallSummaryActions(this.ref, this.chatId);

  final WidgetRef ref;
  final int chatId;

  CallLogRepository get _repository => ref.read(callLogRepositoryProvider);

  /// RN `handleSummaryNameChange` (`PATCH /chats/:id/call-info`). Returns
  /// whether the rename stuck, so the header can keep the new name.
  Future<bool> rename(String newName) async {
    try {
      await _repository.updateSummaryName(chatId, newName);
      showCallSummaryToast(ref.tr('callSummary.info.summaryNameUpdateSuccess'));
      return true;
    } catch (error) {
      showCallSummaryToast(callSummaryErrorMessage(error, ref.tr('callSummary.info.summaryNameUpdateFailed')));
      return false;
    }
  }

  /// RN `handleExport`: storage permission (Android 9 and below; a denial
  /// toasts `storagePermissionDenied` and opens app settings), `GET
  /// /chats/:id/export-summary` as text, then `saveFile` and the
  /// `fileExportedSuccess` toast. Any failure is `fileExportFailed`.
  Future<bool> export() async {
    final saver = ref.read(summaryFileSaverProvider);
    try {
      final permission = await saver.checkAndRequestPermissions();
      if (permission != StoragePermissionResult.granted) {
        showCallSummaryToast(ref.tr('callSummary.info.storagePermissionDenied'));
        await saver.openSettings();
        return false;
      }
      final content = await _repository.exportCallSummary(chatId);
      await saver.saveFile(content: content, chatId: chatId);
      showCallSummaryToast(ref.tr('callSummary.info.fileExportedSuccess'));
      return true;
    } on FormatException {
      showCallSummaryToast(ref.tr('callSummary.info.invalidResponseFormat'));
      return false;
    } catch (error) {
      showCallSummaryToast(callSummaryErrorMessage(error, ref.tr('callSummary.info.fileExportFailed')));
      return false;
    }
  }

  /// RN `handleArchive` (`PATCH /chats/call-logs/:id/archive {archive}`).
  Future<bool> archive({required bool archive}) async {
    final action = archive ? 'archive' : 'unarchive';
    try {
      await _repository.archiveCallLog(chatId, archive: archive);
      showCallSummaryToast(ref.tr('callSummary.archiveActionModal.$action.success'));
      return true;
    } catch (error) {
      showCallSummaryToast(callSummaryErrorMessage(error, ref.tr('callSummary.archiveActionModal.$action.failed')));
      return false;
    }
  }

  /// RN `handleDelete`: `PUT /chats/:id/call-details {summary: {}}`, the
  /// `summaryDeletedSuccess` toast, then (the caller) going back after 2s.
  /// RN's menu never opens the delete modal (`activeModal` is only ever set
  /// to `'rename'`), so nothing in the menu calls this either.
  Future<bool> delete() async {
    try {
      await _repository.deleteCallSummary(chatId);
      showCallSummaryToast(ref.tr('callSummary.info.summaryDeletedSuccess'));
      return true;
    } catch (_) {
      showCallSummaryToast(ref.tr('callSummary.info.summaryDeleteFailed'));
      return false;
    }
  }
}
