package com.helloally.ally_mobile_flutter

import android.database.sqlite.SQLiteDatabase
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Call summary export (lib/features/calllog/data/summary_file_export.dart):
        // RN's react-native-fs DownloadDirectoryPath + scanFile, and the SDK
        // level useStoragePermissions branches on.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ally/file_export")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "sdkInt" -> result.success(Build.VERSION.SDK_INT)
                    "downloadsDir" -> result.success(
                        @Suppress("DEPRECATION")
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                            .absolutePath,
                    )
                    "scanFile" -> {
                        val path = call.argument<String>("path")
                        if (path == null) {
                            result.success(null)
                        } else {
                            MediaScannerConnection.scanFile(this, arrayOf(path), null) { _, _ -> }
                            result.success(null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
        // One-time sign-in migration from the React Native app this build
        // replaces (lib/core/migration/legacy_session_migration.dart). RN's
        // AsyncStorage keeps every key in the SQLite database "RKStorage",
        // table catalystLocalStorage(key TEXT PRIMARY KEY, value TEXT). Only
        // the requested keys are read and nothing is written or logged.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ally/legacy_rn_storage")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "readAsyncStorage" -> {
                        val keys = call.argument<List<String>>("keys") ?: emptyList()
                        try {
                            result.success(readRnAsyncStorage(keys))
                        } catch (e: Exception) {
                            result.error("read_failed", e.javaClass.simpleName, null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /** null when RN never ran on this install (no database file). */
    private fun readRnAsyncStorage(keys: List<String>): Map<String, String>? {
        val dbFile = getDatabasePath("RKStorage")
        if (!dbFile.exists() || keys.isEmpty()) return null
        // Read-write open (no writes happen) so SQLite can replay a WAL
        // that RN left behind; a read-only open can fail on one.
        val db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READWRITE)
        try {
            val placeholders = keys.joinToString(",") { "?" }
            val values = mutableMapOf<String, String>()
            db.rawQuery(
                "SELECT key, value FROM catalystLocalStorage WHERE key IN ($placeholders)",
                keys.toTypedArray(),
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    values[cursor.getString(0)] = cursor.getString(1)
                }
            }
            return values
        } finally {
            db.close()
        }
    }
}
