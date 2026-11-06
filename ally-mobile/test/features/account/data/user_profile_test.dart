import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';

void main() {
  group('UserProfile.fromJson', () {
    test('parses a fully populated profile', () {
      final user = UserProfile.fromJson({
        'id': 42,
        'email': 'jane@example.com',
        'name': 'Jane Doe',
        'phone': '+1-555-0100',
        'profileImageUrl': 'https://cdn.example.com/jane.png',
        'profileCompleted': true,
      });

      expect(user.id, 42);
      expect(user.email, 'jane@example.com');
      expect(user.name, 'Jane Doe');
      expect(user.phone, '+1-555-0100');
      expect(user.profileImageUrl, 'https://cdn.example.com/jane.png');
      expect(user.profileCompleted, isTrue);
    });

    test('id arrives as a double (JSON number) and still parses as int', () {
      final user = UserProfile.fromJson({
        'id': 42.0,
        'email': 'jane@example.com',
      });

      expect(user.id, 42);
      expect(user.id, isA<int>());
    });

    test('defaults name/phone to empty string when absent', () {
      final user = UserProfile.fromJson({'id': 1, 'email': 'a@b.com'});

      expect(user.name, '');
      expect(user.phone, '');
    });

    test('defaults profileImageUrl to null when absent', () {
      final user = UserProfile.fromJson({'id': 1, 'email': 'a@b.com'});

      expect(user.profileImageUrl, isNull);
    });

    test(
      'defaults profileCompleted to false when absent — a bulk-created '
      'account predating the field reads as incomplete, not a parse crash',
      () {
        final user = UserProfile.fromJson({'id': 1, 'email': 'a@b.com'});

        expect(user.profileCompleted, isFalse);
      },
    );
  });
}
