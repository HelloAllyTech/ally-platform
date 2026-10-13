/// Mirrors ally-mobile (React Native)'s `src/types/user.ts` `User` interface.
class UserProfile {
  UserProfile({
    required this.id,
    required this.email,
    required this.name,
    required this.phone,
    required this.profileImageUrl,
    required this.profileCompleted,
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
      );

  final int id;
  final String email;
  final String name;
  final String phone;
  final String? profileImageUrl;
  final bool profileCompleted;
}
