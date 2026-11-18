import '../../../core/branding/tenant_branding.dart';

/// Mirrors ally-mobile (React Native)'s `src/types/user.ts` `User` interface.
class UserProfile {
  UserProfile({
    required this.id,
    required this.email,
    required this.name,
    required this.phone,
    required this.profileImageUrl,
    required this.profileCompleted,
    this.role,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
        id: (json['id'] as num).toInt(),
        email: json['email'] as String,
        name: json['name'] as String? ?? '',
        phone: json['phone'] as String? ?? '',
        profileImageUrl: json['profileImageUrl'] as String?,
        // Same leniency RN's type comment calls for: a bulk-created account
        // predating this field should read as incomplete, not crash parsing.
        profileCompleted: json['profileCompleted'] as bool? ?? false,
        role: json['role'] as String?,
      );

  final int id;
  final String email;
  final String name;
  final String phone;
  final String? profileImageUrl;
  final bool profileCompleted;

  /// RN's `UserRole` (`LEARNER`, `COUNSELOR`, ...).
  final String? role;

  bool get isLearner => role == 'LEARNER';
}

/// Mirrors ally-mobile (React Native)'s `authApi.ts` `LogoUrlResponse` —
/// the signed-in user's organization, shown in the drawer header — plus
/// the resolved org [branding] ally-be now returns beside it.
class TenantInfo {
  TenantInfo({required this.name, required this.logoUrl, this.branding = TenantBranding.ally});

  factory TenantInfo.fromJson(Map<String, dynamic> json) => TenantInfo(
        name: json['name'] as String? ?? '',
        logoUrl: json['logoUrl'] as String?,
        branding: switch (json['branding']) {
          final Map<String, dynamic> raw => TenantBranding.fromJson(raw),
          _ => TenantBranding.ally,
        },
      );

  final String name;
  final String? logoUrl;

  /// Ally's own values unless the org's branding switch is on.
  final TenantBranding branding;
}
