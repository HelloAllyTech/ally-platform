import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
// ignore: depend_on_referenced_packages
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/account/presentation/profile_settings_screen.dart';

import '../../../support/fake_network_image.dart';
import '../../../support/pump_app.dart';

class MockAccountRepository extends Mock implements AccountRepository {}

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

UserProfile _user({String? profileImageUrl}) => UserProfile(
  id: 1,
  email: 'jane@example.com',
  name: 'Jane Doe',
  phone: '555-1234',
  profileImageUrl: profileImageUrl,
  profileCompleted: true,
);

void main() {
  setUpAll(() {
    registerFallbackValue(File(''));
  });

  List<RouteBase> routes() => [
    GoRoute(path: '/profile', builder: (context, state) => const ProfileSettingsScreen()),
  ];

  testWidgets(
    'ProfileSettingsScreen: real labeled fields, image upload/remove via the '
    'options sheet, and the language selector — driven as sequential steps '
    'in one test (pumpRoutedApp stalls translations on a second call within '
    'the same file; see its own doc comment)',
    (tester) async {
      await withFakeNetworkImages(() async {
        final fakePicker = _FakeImagePickerPlatform();
        ImagePickerPlatform.instance = fakePicker;

        // --- Step 1: renders the real labeled Name/Email/Language fields — ---
        // --- not the phone number RN never shows here, and no logout      ---
        // --- action (that only lives in the drawer; a prior version added ---
        // --- one that isn't in the real app) or Preferences row.          ---
        final repository = MockAccountRepository();
        when(() => repository.getUser()).thenAnswer((_) async => _user());

        await pumpRoutedApp(
          tester,
          initialLocation: '/profile',
          routes: routes(),
          overrides: [accountRepositoryProvider.overrideWithValue(repository)],
        );

        expect(find.text('Jane Doe'), findsOneWidget);
        expect(find.text('jane@example.com'), findsOneWidget);
        expect(find.text('English'), findsOneWidget, reason: 'the current UI language');
        expect(find.text('555-1234'), findsNothing);
        expect(find.text('Logout'), findsNothing);
        expect(find.text('Preferences'), findsNothing);

        // --- Step 2: no photo yet — the options sheet offers only one ---
        // --- entry (itself labelled "Upload Image", not "Change"),    ---
        // --- and cancelling the picker (returns null) uploads nothing. ---
        fakePicker.imagePathToReturn = null;
        await tester.tap(find.text('Upload Image'));
        await tester.pumpAndSettle();

        expect(find.text('Upload Image'), findsNWidgets(2), reason: 'the trigger + the sheet option');
        expect(find.text('Remove image'), findsNothing);

        await tester.tap(find.text('Upload Image').last);
        await tester.pumpAndSettle();

        verifyNever(() => repository.uploadProfileImage(any()));

        // --- Step 3: picking an image uploads it through the repository. ---
        fakePicker.imagePathToReturn = '/tmp/fake-avatar.jpg';
        when(() => repository.uploadProfileImage(any())).thenAnswer((_) async {});

        await tester.tap(find.text('Upload Image'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Upload Image').last);
        await tester.pumpAndSettle();

        final captured = verify(() => repository.uploadProfileImage(captureAny())).captured;
        expect(captured, hasLength(1));
        expect((captured.single as File).path, '/tmp/fake-avatar.jpg');

        // --- Step 4: an existing photo's sheet offers Change AND Remove, ---
        // --- and Remove deletes that exact URL.                         ---
        final repositoryWithPhoto = MockAccountRepository();
        when(() => repositoryWithPhoto.getUser()).thenAnswer(
          (_) async => _user(profileImageUrl: 'https://cdn.example.com/jane.png'),
        );
        when(() => repositoryWithPhoto.deleteProfileImage(any())).thenAnswer((_) async {});

        await pumpRoutedApp(
          tester,
          initialLocation: '/profile',
          routes: routes(),
          overrides: [accountRepositoryProvider.overrideWithValue(repositoryWithPhoto)],
        );

        await tester.tap(find.text('Upload Image'));
        await tester.pumpAndSettle();

        expect(find.text('Change image'), findsOneWidget);
        expect(find.text('Remove image'), findsOneWidget);

        await tester.tap(find.text('Remove image'));
        await tester.pumpAndSettle();

        verify(
          () => repositoryWithPhoto.deleteProfileImage('https://cdn.example.com/jane.png'),
        ).called(1);

        // --- Step 5: tapping Language opens the language selector sheet. ---
        await tester.tap(find.text('English'));
        await tester.pumpAndSettle();

        expect(find.text('App Language'), findsOneWidget);
        expect(find.text('हिंदी'), findsOneWidget);
      });
    },
  );
}
