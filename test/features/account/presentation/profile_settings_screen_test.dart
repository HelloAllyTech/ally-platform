import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
// ignore: depend_on_referenced_packages
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/account/presentation/profile_settings_screen.dart';

import '../../../support/fake_network_image.dart';
import '../../../support/pump_app.dart';

class MockAccountRepository extends Mock implements AccountRepository {}

class _FakeAuthController extends AuthController {
  bool loggedOut = false;

  @override
  AuthState build() => const AuthState(isAuthenticated: true);

  @override
  Future<void> logout() async {
    loggedOut = true;
  }
}

/// Stands in for the real platform plugin, which otherwise throws
/// `MissingPluginException` under `flutter test` — `imagePathToReturn: null`
/// simulates the user backing out of the picker.
class _FakeImagePickerPlatform extends ImagePickerPlatform {
  String? imagePathToReturn;

  @override
  Future<XFile?> getImageFromSource({
    required ImageSource source,
    ImagePickerOptions options = const ImagePickerOptions(),
  }) async {
    final path = imagePathToReturn;
    return path == null ? null : XFile(path);
  }
}

void main() {
  setUpAll(() {
    registerFallbackValue(File(''));
  });

  List<RouteBase> routes() => [
    GoRoute(path: '/profile', builder: (context, state) => const ProfileSettingsScreen()),
    GoRoute(path: '/preferences', builder: (context, state) => const Text('Preferences Screen')),
  ];

  testWidgets(
    'ProfileSettingsScreen: renders user, image change/remove, logout, and navigation',
    (tester) async {
      await withFakeNetworkImages(() async {
        final fakePicker = _FakeImagePickerPlatform();
        ImagePickerPlatform.instance = fakePicker;

        // --- Scenario 1: renders the signed-in user; no photo yet, so no ---
        // --- "Remove image" action is offered.                          ---
        final repository = MockAccountRepository();
        when(() => repository.getUser()).thenAnswer(
          (_) async => UserProfile(
            id: 1,
            email: 'jane@example.com',
            name: 'Jane Doe',
            phone: '555-1234',
            profileImageUrl: null,
            profileCompleted: true,
          ),
        );

        await pumpRoutedApp(
          tester,
          initialLocation: '/profile',
          routes: routes(),
          overrides: [
            accountRepositoryProvider.overrideWithValue(repository),
            authControllerProvider.overrideWith(() => _FakeAuthController()),
          ],
        );

        expect(find.text('Jane Doe'), findsOneWidget);
        expect(find.text('jane@example.com'), findsOneWidget);
        expect(find.text('555-1234'), findsOneWidget);
        expect(find.text('Remove image'), findsNothing);

        // --- Scenario 2: cancelling the picker (returns null) uploads nothing. ---
        fakePicker.imagePathToReturn = null;
        await tester.tap(find.text('Change image'));
        await tester.pumpAndSettle();

        verifyNever(() => repository.uploadProfileImage(any()));

        // --- Scenario 3: picking an image uploads it through the repository. ---
        fakePicker.imagePathToReturn = '/tmp/fake-avatar.jpg';
        when(() => repository.uploadProfileImage(any())).thenAnswer((_) async {});

        await tester.tap(find.text('Change image'));
        await tester.pumpAndSettle();

        final captured = verify(() => repository.uploadProfileImage(captureAny())).captured;
        expect(captured, hasLength(1));
        expect((captured.single as File).path, '/tmp/fake-avatar.jpg');

        // --- Scenario 4: an existing photo offers "Remove image", and ---
        // --- tapping it deletes that exact URL.                       ---
        final repositoryWithPhoto = MockAccountRepository();
        when(() => repositoryWithPhoto.getUser()).thenAnswer(
          (_) async => UserProfile(
            id: 1,
            email: 'jane@example.com',
            name: 'Jane Doe',
            phone: '555-1234',
            profileImageUrl: 'https://cdn.example.com/jane.png',
            profileCompleted: true,
          ),
        );
        when(() => repositoryWithPhoto.deleteProfileImage(any())).thenAnswer((_) async {});

        await pumpRoutedApp(
          tester,
          initialLocation: '/profile',
          routes: routes(),
          overrides: [
            accountRepositoryProvider.overrideWithValue(repositoryWithPhoto),
            authControllerProvider.overrideWith(() => _FakeAuthController()),
          ],
        );

        expect(find.text('Remove image'), findsOneWidget);
        await tester.tap(find.text('Remove image'));
        await tester.pumpAndSettle();

        verify(() => repositoryWithPhoto.deleteProfileImage('https://cdn.example.com/jane.png')).called(1);

        // --- Scenario 5: the Preferences row navigates to /preferences. ---
        await tester.tap(find.text('Preferences'));
        await tester.pumpAndSettle();

        expect(find.text('Preferences Screen'), findsOneWidget);

        // --- Scenario 6: Logout calls authControllerProvider.notifier.logout(). ---
        // (Fresh mount — the previous step navigated away from ProfileSettingsScreen.)
        final repositoryForLogout = MockAccountRepository();
        when(() => repositoryForLogout.getUser()).thenAnswer(
          (_) async => UserProfile(
            id: 1,
            email: 'jane@example.com',
            name: 'Jane Doe',
            phone: '555-1234',
            profileImageUrl: null,
            profileCompleted: true,
          ),
        );
        late _FakeAuthController logoutController;

        await pumpRoutedApp(
          tester,
          initialLocation: '/profile',
          routes: routes(),
          overrides: [
            accountRepositoryProvider.overrideWithValue(repositoryForLogout),
            authControllerProvider.overrideWith(() => logoutController = _FakeAuthController()),
          ],
        );

        await tester.tap(find.text('Logout'));
        await tester.pumpAndSettle();

        expect(logoutController.loggedOut, isTrue);
      });
    },
  );
}
