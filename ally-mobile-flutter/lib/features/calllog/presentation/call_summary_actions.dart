import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/toast/toast_controller.dart';
import '../data/call_log_repository.dart';
import '../data/summary_file_export.dart';

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
      showToast(ref.tr('callSummary.info.summaryNameUpdateSuccess'));
      return true;
    } catch (error) {
      showErrorToast(error, 'callSummary.info.summaryNameUpdateFailed', t: ref.tr);
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
        // RN useStoragePermissions.
        showToast(ref.tr('callSummary.info.storagePermissionDenied'), type: ToastType.error);
        await saver.openSettings();
        return false;
      }
      final content = await _repository.exportCallSummary(chatId);
      await saver.saveFile(content: content, chatId: chatId);
      showToast(ref.tr('callSummary.info.fileExportedSuccess'));
      return true;
    } catch (error) {
      // RN throws `invalidResponseFormat` as a plain Error into this same
      // catch, so a bad body also reads "fileExportFailed: …".
      showErrorToast(error, 'callSummary.info.fileExportFailed', t: ref.tr);
      return false;
    }
  }

  /// RN `handleArchive` (`PATCH /chats/call-logs/:id/archive {archive}`).
  Future<bool> archive({required bool archive}) async {
    final action = archive ? 'archive' : 'unarchive';
    try {
      await _repository.archiveCallLog(chatId, archive: archive);
      showToast(ref.tr('callSummary.archiveActionModal.$action.success'));
      return true;
    } catch (error) {
      showErrorToast(error, 'callSummary.archiveActionModal.$action.failed', t: ref.tr);
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
      showToast(ref.tr('callSummary.info.summaryDeletedSuccess'));
      return true;
    } catch (_) {
      // RN omits the type here (so its default, success); a failure is
      // shown as one.
      showToast(ref.tr('callSummary.info.summaryDeleteFailed'), type: ToastType.error);
      return false;
    }
  }
}
