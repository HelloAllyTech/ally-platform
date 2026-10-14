import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'user_profile.dart';

/// Ported from ally-mobile (React Native)'s `src/services/authApi.ts`.
class AccountRepository {
  AccountRepository(this._dio);

  final Dio _dio;

  Future<UserProfile> getUser() async {
    final response = await _dio.get<Map<String, dynamic>>('/users/me');
    return UserProfile.fromJson(response.data!);
  }

  Future<TenantInfo> getTenant() async {
    final response = await _dio.get<Map<String, dynamic>>('/users/tenant');
    return TenantInfo.fromJson(response.data!);
  }

  Future<void> completeProfile({required String name, String? phone}) async {
    await _dio.patch<void>(
      '/users/me/complete-profile',
      data: {'name': name, 'phone': ?phone},
    );
  }

  /// Full 3-step flow matching the RN app exactly: get a presigned S3 PUT
  /// URL, upload the raw bytes directly to S3 (not through our backend —
  /// a plain PUT, no auth header, that's what "presigned" means), then
  /// PATCH the user record with the resulting public URL.
  Future<void> uploadProfileImage(File file) async {
    final fileSize = await file.length();
    final contentType = _contentTypeFor(file.path);

    final presignResponse = await _dio.post<Map<String, dynamic>>(
      '/users/profile-image-url',
      data: {
        'fileName': file.path.split('/').last,
        'fileSize': fileSize,
        'contentType': contentType,
      },
    );
    final presignedUrl = presignResponse.data!['presignedUrl'] as String;
    final profileImageUrl = presignResponse.data!['profileImageUrl'] as String;

    // Deliberately a bare Dio request, not the shared apiClient — this goes
    // straight to S3 with the presigned URL as its own auth, and must NOT
    // pick up the Bearer token / auth-refresh interceptor meant for our
    // own backend.
    await Dio().put<void>(
      presignedUrl,
      data: file.openRead(),
      options: Options(
        headers: {Headers.contentLengthHeader: fileSize, 'Content-Type': contentType},
      ),
    );

    await _dio.patch<void>('/users/profile-image', data: {'profileImageUrl': profileImageUrl});
  }

  Future<void> deleteProfileImage(String profileImageUrl) async {
    await _dio.delete<void>('/users/profile-image', data: {'profileImageUrl': profileImageUrl});
  }

  String _contentTypeFor(String path) {
    final ext = path.split('.').last.toLowerCase();
    return switch (ext) {
      'png' => 'image/png',
      'heic' => 'image/heic',
      _ => 'image/jpeg',
    };
  }
}

final accountRepositoryProvider = Provider<AccountRepository>((ref) {
  return AccountRepository(ref.watch(apiClientProvider));
});

final currentUserProvider = FutureProvider<UserProfile>((ref) {
  return ref.watch(accountRepositoryProvider).getUser();
});

final tenantInfoProvider = FutureProvider<TenantInfo>((ref) {
  return ref.watch(accountRepositoryProvider).getTenant();
});
