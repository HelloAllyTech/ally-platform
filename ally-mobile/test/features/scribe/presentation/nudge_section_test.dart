import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_repository.dart';
import 'package:ally_mobile_flutter/features/scribe/presentation/nudge_section.dart';

import '../../../support/pump_app.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data) =>
    Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions(path: ''));

// One `testWidgets` per file — see
// network_disconnected_socket_test.dart for why.
void main() {
  testWidgets(
    'shows the nudge content, and tapping thumbs-up submits feedback and highlights it',
    (tester) async {
      final dio = MockDio();
      when(
        () => dio.post<Map<String, dynamic>>('/chats/messages/5/feedback', data: {'rating': 1}),
      ).thenAnswer((_) async => _response({'feedbackId': 10, 'rating': 1}));

      await pumpApp(
        tester,
        Scaffold(
          body: NudgeSection(
            nudge: Nudge(id: 5, content: 'Try asking an open question.', chatId: 1, senderId: 2, createdAt: 't1'),
          ),
        ),
        overrides: [
          chatRepositoryProvider.overrideWithValue(ChatRepository(dio)),
          userPermissionsProvider.overrideWith(
            (ref) async => [UserPermissions.editMessageFeedback],
          ),
        ],
      );

      expect(find.text('Try asking an open question.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('nudge-thumb-up')));
      await tester.pumpAndSettle();

      verify(
        () => dio.post<Map<String, dynamic>>('/chats/messages/5/feedback', data: {'rating': 1}),
      ).called(1);
      final icon = tester.widget<SvgPicture>(
        find.descendant(of: find.byKey(const ValueKey('nudge-thumb-up')), matching: find.byType(SvgPicture)),
      );
      // RN: a chosen thumb turns white (powderBlue otherwise).
      expect(icon.colorFilter, const ColorFilter.mode(Colors.white, BlendMode.srcIn));
      // RN always shows "Is this helpful?".
      expect(find.text('Is this helpful'), findsOneWidget);

      // Re-tapping the same rating is a no-op (RN skips the same rating).
      await tester.pump(const Duration(milliseconds: 600));
      await tester.tap(find.byKey(const ValueKey('nudge-thumb-up')));
      await tester.pumpAndSettle();
      verifyNever(() => dio.patch<Map<String, dynamic>>(any(), data: any(named: 'data')));
    },
  );
}
