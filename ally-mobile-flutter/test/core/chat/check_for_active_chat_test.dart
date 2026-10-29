import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/chat/active_chat_discovery.dart';
import 'package:ally_mobile_flutter/core/chat/current_chat_provider.dart';
import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_repository.dart';

class MockChatRepository extends Mock implements ChatRepository {}

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._state);

  final AuthState _state;

  @override
  AuthState build() => _state;
}

/// Captures a real, mounted [WidgetRef] + [GoRouter] + [ProviderContainer]
/// trio. `GoRouter`'s `routerDelegate.currentConfiguration` (what
/// `checkForActiveChat` reads to know the current location, and what
/// changes on a successful `.go()`) only populates once it's actually
/// attached via `MaterialApp.router` — a standalone, unmounted `GoRouter()`
/// reports an empty location for it.
///
/// The container is exposed separately from the captured [WidgetRef]
/// because a successful `.go()` call unmounts the route that captured the
/// ref — reading through it afterwards throws ("using ref ... after
/// unmounted"). Use `ref` only to invoke `checkForActiveChat` itself; use
/// `container` for any assertion made after a navigation may have occurred.
Future<({WidgetRef ref, GoRouter router, ProviderContainer container})> _mount(
  WidgetTester tester, {
  required String initialLocation,
  required List<Override> overrides,
}) async {
  final container = ProviderContainer(overrides: overrides);
  addTearDown(container.dispose);

  late WidgetRef capturedRef;
  Widget captureAndRender(BuildContext context, GoRouterState state) {
    return Consumer(
      builder: (context, ref, _) {
        capturedRef = ref;
        return const SizedBox();
      },
    );
  }

  final router = GoRouter(
    initialLocation: initialLocation,
    routes: [
      GoRoute(path: '/home', builder: captureAndRender),
      GoRoute(path: '/call-log', builder: captureAndRender),
      GoRoute(path: '/scribe', builder: captureAndRender),
      GoRoute(path: '/conference-listening/:chatId', builder: captureAndRender),
    ],
  );

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ),
  );

  // `userPermissionsProvider` is a FutureProvider; its overridden async
  // callback needs a microtask tick to resolve. Without this, a `ref.read`
  // immediately after mount sees `AsyncLoading` (`.value == null`), making
  // `checkForActiveChat`'s permission check silently fail closed regardless
  // of the override.
  await container.read(userPermissionsProvider.future);

  return (ref: capturedRef, router: router, container: container);
}

void main() {
  late MockChatRepository chatRepository;

  setUp(() {
    chatRepository = MockChatRepository();
  });

  List<Override> overridesFor({
    required bool isAuthenticated,
    List<String> permissions = const [UserPermissions.viewCounselorChat],
  }) => [
    chatRepositoryProvider.overrideWithValue(chatRepository),
    userPermissionsProvider.overrideWith((ref) async => permissions),
    authControllerProvider.overrideWith(
      () => _FakeAuthController(AuthState(isAuthenticated: isAuthenticated)),
    ),
  ];

  testWidgets('unauthenticated: never calls getCounsellorChat at all', (tester) async {
    final mounted = await _mount(
      tester,
      initialLocation: '/home',
      overrides: overridesFor(isAuthenticated: false),
    );

    await checkForActiveChat(mounted.ref, mounted.router);

    verifyNever(() => chatRepository.getCounsellorChat());
  });

  testWidgets('without the viewCounselorChat permission: never calls getCounsellorChat', (
    tester,
  ) async {
    final mounted = await _mount(
      tester,
      initialLocation: '/home',
      overrides: overridesFor(isAuthenticated: true, permissions: const []),
    );

    await checkForActiveChat(mounted.ref, mounted.router);

    verifyNever(() => chatRepository.getCounsellorChat());
  });

  testWidgets(
    'an active conference chat found while elsewhere navigates to /conference-listening/:id',
    (tester) async {
      when(() => chatRepository.getCounsellorChat()).thenAnswer(
        (_) async => Chat(
          chatId: 42,
          status: ChatStatus.active,
          provider: ChatProvider.exotelConferenceCall,
          startedAt: '2026-01-01T10:00:00Z',
        ),
      );
      final mounted = await _mount(
        tester,
        initialLocation: '/home',
        overrides: overridesFor(isAuthenticated: true),
      );

      await checkForActiveChat(mounted.ref, mounted.router);
      await tester.pumpAndSettle();

      expect(
        mounted.router.routerDelegate.currentConfiguration.uri.toString(),
        '/conference-listening/42',
      );
      expect(mounted.container.read(currentChatProvider)?.chatId, 42);
    },
  );

  testWidgets('already on the listening route for the discovered chat: no navigation (no-op)', (
    tester,
  ) async {
    when(() => chatRepository.getCounsellorChat()).thenAnswer(
      (_) async => Chat(
        chatId: 42,
        status: ChatStatus.active,
        provider: ChatProvider.exotelConferenceCall,
        startedAt: '2026-01-01T10:00:00Z',
      ),
    );
    final mounted = await _mount(
      tester,
      initialLocation: '/conference-listening/42',
      overrides: overridesFor(isAuthenticated: true),
    );

    await checkForActiveChat(mounted.ref, mounted.router);
    await tester.pumpAndSettle();

    expect(
      mounted.router.routerDelegate.currentConfiguration.uri.toString(),
      '/conference-listening/42',
    );
  });

  testWidgets('no active chat, and the current route is NOT exempt: clears currentChatProvider', (
    tester,
  ) async {
    when(() => chatRepository.getCounsellorChat()).thenAnswer((_) async => null);
    final mounted = await _mount(
      tester,
      initialLocation: '/call-log',
      overrides: overridesFor(isAuthenticated: true),
    );
    mounted.container.read(currentChatProvider.notifier).set(
      Chat(
        chatId: 1,
        status: ChatStatus.active,
        provider: ChatProvider.microphone,
        startedAt: '2026-01-01T10:00:00Z',
      ),
    );

    await checkForActiveChat(mounted.ref, mounted.router);

    expect(mounted.container.read(currentChatProvider), isNull);
  });

  testWidgets(
    'no active chat, but the current route IS exempt: keeps the stale chat (race tolerance)',
    (tester) async {
      when(() => chatRepository.getCounsellorChat()).thenAnswer((_) async => null);
      final mounted = await _mount(
        tester,
        initialLocation: '/scribe',
        overrides: overridesFor(isAuthenticated: true),
      );
      final staleChat = Chat(
        chatId: 1,
        status: ChatStatus.active,
        provider: ChatProvider.microphone,
        startedAt: '2026-01-01T10:00:00Z',
      );
      mounted.container.read(currentChatProvider.notifier).set(staleChat);

      await checkForActiveChat(mounted.ref, mounted.router);

      expect(mounted.container.read(currentChatProvider), staleChat);
    },
  );

  testWidgets('a /scribe pushed over /home counts as the listening route: no navigation', (tester) async {
    when(() => chatRepository.getCounsellorChat()).thenAnswer(
      (_) async => Chat(chatId: 7, status: ChatStatus.active, provider: ChatProvider.microphone, startedAt: '2026-01-01T10:00:00Z'),
    );
    final mounted = await _mount(
      tester,
      initialLocation: '/home',
      overrides: overridesFor(isAuthenticated: true),
    );
    unawaited(mounted.router.push('/scribe'));
    await tester.pumpAndSettle();
    // The bug: `currentConfiguration.uri` still reads /home here.
    expect(mounted.router.routerDelegate.currentConfiguration.uri.toString(), '/home');

    await checkForActiveChat(mounted.ref, mounted.router);
    await tester.pumpAndSettle();

    // Still on the pushed /scribe, not replaced by a fresh go('/scribe').
    expect(mounted.router.canPop(), isTrue);
  });
}
