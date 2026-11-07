import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

/// Fake for `path_provider`'s platform-interface seam, same reasoning as
/// `mock_record_platform.dart`'s `MockRecordPlatform`: `getTemporaryDirectory()`
/// hits a real platform channel with no default test binding, which throws
/// `MissingPluginException` in a bare `flutter test` run.
class FakePathProviderPlatform extends PathProviderPlatform with MockPlatformInterfaceMixin {
  @override
  Future<String?> getTemporaryPath() async => '/tmp/ally-mobile-flutter-test';
}

/// Installs a [FakePathProviderPlatform] returning a fixed, fake temp path.
void installFakePathProvider() {
  PathProviderPlatform.instance = FakePathProviderPlatform();
}
