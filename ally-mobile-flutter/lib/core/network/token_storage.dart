import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Flutter equivalent of ally-mobile (React Native)'s AsyncStorage-backed
/// token pair, same key names as `src/constants/asyncStorage.ts` so a token
/// migration path between the two apps stays conceptually simple even though
/// the underlying storage mechanism differs. Uses flutter_secure_storage
/// (Keychain/Keystore-backed) rather than shared_preferences deliberately —
/// tokens are credentials, not app preferences, and RN's AsyncStorage being
/// unencrypted was never actually a deliberate choice worth repeating here.
class TokenStorage {
  TokenStorage({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _accessTokenKey = 'ACCESS_TOKEN';
  static const _refreshTokenKey = 'REFRESH_TOKEN';

  Future<String?> get accessToken => _storage.read(key: _accessTokenKey);

  Future<String?> get refreshToken => _storage.read(key: _refreshTokenKey);

  Future<void> storeTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);
    await _storage.write(key: _refreshTokenKey, value: refreshToken);
  }

  Future<void> clear() async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
  }
}
