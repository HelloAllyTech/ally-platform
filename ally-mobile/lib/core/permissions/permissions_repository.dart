import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_client.dart';

/// Ported from ally-mobile (React Native)'s `src/services/authApi.ts`
/// `getPermissions` query — a flat `string[]` of [UserPermissions] values,
/// fetched separately from `/users/me` (not part of the login response;
/// see `useUser.ts`'s `checkAuth()`, which fires both calls together).
class PermissionsRepository {
  PermissionsRepository(this._dio);

  final Dio _dio;

  Future<List<String>> getPermissions() async {
    final response = await _dio.get<List<dynamic>>('/authorization/permissions');
    return (response.data ?? []).cast<String>();
  }
}

final permissionsRepositoryProvider = Provider<PermissionsRepository>((ref) {
  return PermissionsRepository(ref.watch(apiClientProvider));
});

/// Mirrors Redux's `state.user.permissions` — read by the nav shell to
/// decide which tabs/drawer items are visible, same as RN's `BottomTabs`.
final userPermissionsProvider = FutureProvider<List<String>>((ref) {
  return ref.watch(permissionsRepositoryProvider).getPermissions();
});
