import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'user_profile.dart';

/// Ported from ally-mobile (React Native)'s `src/services/authApi.ts` —
/// `getUser`/`completeProfile` only for this pass. Profile image upload
/// (presigned URL → PATCH /users/profile-image) is real further work, not
/// done here.
class AccountRepository {
  AccountRepository(this._dio);

  final Dio _dio;

  Future<UserProfile> getUser() async {
    final response = await _dio.get<Map<String, dynamic>>('/users/me');
    return UserProfile.fromJson(response.data!);
  }

  Future<void> completeProfile({required String name, String? phone}) async {
    await _dio.patch<void>(
      '/users/me/complete-profile',
      data: {'name': name, if (phone != null) 'phone': phone},
    );
  }
}

final accountRepositoryProvider = Provider<AccountRepository>((ref) {
  return AccountRepository(ref.watch(apiClientProvider));
});

final currentUserProvider = FutureProvider<UserProfile>((ref) {
  return ref.watch(accountRepositoryProvider).getUser();
});
