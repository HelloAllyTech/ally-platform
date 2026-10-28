import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/presentation/complete_profile_screen.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_repository.dart';

import '../../../support/pump_app.dart';

class MockAccountRepository extends Mock implements AccountRepository {}

class MockChatRepository extends Mock implements ChatRepository {}

class _FakeAuthController extends AuthController {
  @override
  AuthState build() => const AuthState(isAuthenticated: true);
}

void main() {
  // RN resets to Splash after completing the profile, and Splash re-runs the
  // active counsellor-chat check: a live chat wins over Home.
  testWidgets('CompleteProfileScreen: success routes to a live chat instead of /home', (tester) async {
    final account = MockAccountRepository();
    when(() => account.completeProfile(name: 'Jane Doe')).thenAnswer((_) async {});
    final chats = MockChatRepository();
    when(() => chats.getCounsellorChat()).thenAnswer(
      (_) async => Chat(
        chatId: 42,
        status: ChatStatus.active,
        provider: ChatProvider.exotelConferenceCall,
        startedAt: '2026-01-01T10:00:00Z',
      ),
    );

    await pumpRoutedApp(
      tester,
      initialLocation: '/complete-profile',
      routes: [
        GoRoute(path: '/complete-profile', builder: (context, state) => const CompleteProfileScreen()),
        GoRoute(path: '/home', builder: (context, state) => const Text('Home Screen')),
        GoRoute(
          path: '/conference-listening/:chatId',
          builder: (context, state) => Text('Listening ${state.pathParameters['chatId']}'),
        ),
      ],
      overrides: [
        accountRepositoryProvider.overrideWithValue(account),
        chatRepositoryProvider.overrideWithValue(chats),
        userPermissionsProvider.overrideWith((ref) async => const [UserPermissions.viewCounselorChat]),
        authControllerProvider.overrideWith(_FakeAuthController.new),
      ],
    );

    await tester.enterText(find.byType(TextField), 'Jane Doe');
    await tester.pump();
    await tester.tap(find.widgetWithText(AppButton, 'Continue'));
    await tester.pumpAndSettle();

    verify(() => chats.getCounsellorChat()).called(1);
    expect(find.text('Listening 42'), findsOneWidget);
    expect(find.text('Home Screen'), findsNothing);
  });
}
