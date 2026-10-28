package com.helloally.ally_mobile_flutter

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
    }
}
