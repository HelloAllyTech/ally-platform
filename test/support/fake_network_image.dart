import 'dart:async';
import 'dart:io';

import 'package:flutter/painting.dart';
import 'package:mocktail/mocktail.dart';

/// A minimal 1x1 transparent PNG — enough for `dart:ui`'s image codec to
/// decode successfully.
const _kTransparentPng = <int>[
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, //
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
  0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

class _FakeHttpHeaders extends Fake implements HttpHeaders {
  @override
  void add(String name, Object value, {bool preserveHeaderCase = false}) {}
}

class _FakeHttpClientResponse extends Fake implements HttpClientResponse {
  @override
  int get statusCode => 200;

  @override
  int get contentLength => _kTransparentPng.length;

  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    return Stream<List<int>>.fromIterable([_kTransparentPng]).listen(
      onData,
      onError: onError,
      onDone: onDone,
      cancelOnError: cancelOnError ?? false,
    );
  }
}

class _FakeHttpClientRequest extends Fake implements HttpClientRequest {
  @override
  final HttpHeaders headers = _FakeHttpHeaders();

  @override
  Future<HttpClientResponse> close() async => _FakeHttpClientResponse();
}

class _FakeHttpClient extends Fake implements HttpClient {
  @override
  Future<HttpClientRequest> getUrl(Uri url) async => _FakeHttpClientRequest();
}

/// Routes every `NetworkImage` load (as used by `CircleAvatar`'s
/// `backgroundImage`, etc.) to a fake in-memory response carrying a tiny
/// valid PNG, via Flutter's own test-only `debugNetworkImageHttpClientProvider`
/// hook (see `package:flutter/src/painting/debug.dart`'s doc comment: "This
/// setting can be overridden for testing").
///
/// Without this, any widget test that pumps a screen rendering a
/// `NetworkImage` backed by a fake/unreachable URL fails outright —
/// `TestWidgetsFlutterBinding` treats the real `NetworkImageLoadException`
/// (no real network in the test environment) as a reported error, even
/// though the production widget itself handles a real load failure
/// gracefully (shows a fallback child).
///
/// Wrap the whole test body (not just the pump), e.g.:
/// ```dart
/// testWidgets('...', (tester) async {
///   await withFakeNetworkImages(() async {
///     await pumpApp(tester, const MyScreen());
///     ...
///   });
/// });
/// ```
/// `debugNetworkImageHttpClientProvider` must be reset to `null` again
/// *before* `TestWidgetsFlutterBinding`'s end-of-test invariant check runs —
/// that check happens synchronously right after the test body's `Future`
/// completes, which is earlier than any `addTearDown`/`tearDown` callback
/// fires, so resetting must happen via this wrapper's own `finally`, not a
/// tear-down hook.
Future<void> withFakeNetworkImages(Future<void> Function() body) async {
  debugNetworkImageHttpClientProvider = () => _FakeHttpClient();
  try {
    await body();
  } finally {
    debugNetworkImageHttpClientProvider = null;
  }
}
