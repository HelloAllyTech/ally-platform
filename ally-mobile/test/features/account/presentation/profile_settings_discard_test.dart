import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
// ignore: depend_on_referenced_packages
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/account/presentation/profile_settings_screen.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';
import '../../../support/signed_in_auth.dart';

class _MockAccountRepository extends Mock implements AccountRepository {}

class _FakeImagePickerPlatform extends ImagePickerPlatform {
  @override
  Future<XFile?> getImageFromSource({
    required ImageSource source,
    ImagePickerOptions options = const ImagePickerOptions(),
  }) async => XFile('/tmp/fake-avatar.jpg');
}

void main() {
  setUpAll(() => registerFallbackValue(File('')));

  testWidgets('leaving with an unsaved photo asks to discard; Cancel stays, '
      'Discard leaves without uploading; with no changes back just leaves', (tester) async {
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    final repository = _MockAccountRepository();
    when(() => repository.getUser()).thenAnswer(
      (_) async => UserProfile(
        id: 1,
        email: 'jane@example.com',
        name: 'Jane Doe',
        phone: '',
        profileImageUrl: null,
        profileCompleted: true,
      ),
    );

    await pumpRoutedApp(
      tester,
      initialLocation: '/home',
      routes: [
        GoRoute(
          path: '/home',
          builder: (context, _) => Scaffold(
            body: TextButton(onPressed: () => context.push('/profile'), child: const Text('open profile')),
          ),
        ),
        GoRoute(path: '/profile', builder: (_, _) => const ProfileSettingsScreen()),
      ],
      overrides: [
        fixedTranslationsOverride(),
        accountRepositoryProvider.overrideWithValue(repository),
        signedInAuthOverride(),
      ],
    );
    final back = find.byKey(const Key('back-title-header-back'));

    // No changes: back pops straight away.
    await tester.tap(find.text('open profile'));
    await tester.pumpAndSettle();
    await tester.tap(back);
    await tester.pumpAndSettle();
    expect(find.text('open profile'), findsOneWidget);

    // Pick a photo -> unsaved preview.
    await tester.tap(find.text('open profile'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Upload Image'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Upload Image').last);
    await tester.pumpAndSettle();
    expect(find.text('Save'), findsOneWidget);

    await tester.tap(back);
    await tester.pumpAndSettle();
    expect(find.textContaining('Unsaved Changes'), findsOneWidget);
    expect(find.text('You have unsaved changes. Are you sure you want to discard them?'), findsOneWidget);

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Unsaved Changes'), findsNothing);
    expect(find.text('Save'), findsOneWidget, reason: 'still on Profile Settings with the preview');

    await tester.tap(back);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Discard'));
    await tester.pumpAndSettle();
    expect(find.text('open profile'), findsOneWidget);
    verifyNever(() => repository.uploadProfileImage(any()));
  });
}
