import 'dart:ui' show Color;

/// The org branding `GET /v1/users/tenant` resolves for the signed-in
/// user's organization (ally-be's `TenantBrandingResponseDto`): always
/// complete, Ally's own values when the org's switch is off.
///
/// Mirrors the consumer web's `TenantBranding` type. The ramp is computed
/// server-side from the one brand colour (tints 50..400, shades 600..900),
/// so every client paints the same shades.
class TenantBranding {
  const TenantBranding({
    required this.enabled,
    required this.displayName,
    required this.logoUrl,
    required this.primaryColor,
    required this.welcomeLine,
    required this.ramp,
    required this.onPrimary,
  });

  /// Lenient on purpose: a backend older than this field, or a partial
  /// payload, reads as "switch off" rather than a parse crash on sign-in.
  factory TenantBranding.fromJson(Map<String, dynamic> json) {
    final tokens = json['tokens'] as Map<String, dynamic>?;
    final rampJson = tokens?['primary'] as Map<String, dynamic>?;
    final primary = parseHexColor(json['primaryColor'] as String?);
    if (primary == null) return ally;

    final ramp = <int, Color>{};
    for (final step in rampSteps) {
      final color = parseHexColor(rampJson?['$step'] as String?);
      if (color == null) return ally;
      ramp[step] = color;
    }
    final onPrimary = parseHexColor(tokens?['onPrimary'] as String?) ?? ally.onPrimary;

    return TenantBranding(
      enabled: json['enabled'] as bool? ?? false,
      displayName: (json['displayName'] as String?)?.trim().isNotEmpty == true
          ? (json['displayName'] as String).trim()
          : ally.displayName,
      logoUrl: _nonEmpty(json['logoUrl'] as String?),
      primaryColor: primary,
      welcomeLine: _nonEmpty(json['welcomeLine'] as String?),
      ramp: Map.unmodifiable(ramp),
      onPrimary: onPrimary,
    );
  }

  static const rampSteps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

  /// Ally's own identity, as the backend resolves it for an org with the
  /// switch off. Also what every client falls back to.
  static const ally = TenantBranding(
    enabled: false,
    displayName: 'Ally',
    logoUrl: null,
    primaryColor: Color(0xFF264D8E),
    welcomeLine: null,
    ramp: {
      50: Color(0xFFEEF1F6),
      100: Color(0xFFDCE3ED),
      200: Color(0xFFBAC6DB),
      300: Color(0xFF93A6C7),
      400: Color(0xFF637FAE),
      500: Color(0xFF264D8E),
      600: Color(0xFF1F3F74),
      700: Color(0xFF183159),
      800: Color(0xFF10203C),
      900: Color(0xFF0A1425),
    },
    onPrimary: Color(0xFFFAF9F5),
  );

  /// The org switch. Off, the stored values are kept server-side but every
  /// client shows Ally; only [enabled] branding is ever painted.
  final bool enabled;
  final String displayName;
  final String? logoUrl;
  final Color primaryColor;
  final String? welcomeLine;

  /// Tints and shades of [primaryColor], keyed 50..900 (500 == primary).
  final Map<int, Color> ramp;

  /// Text/icon colour on [primaryColor].
  final Color onPrimary;

  Map<String, dynamic> toJson() => {
        'enabled': enabled,
        'displayName': displayName,
        'logoUrl': logoUrl,
        'primaryColor': toHex(primaryColor),
        'welcomeLine': welcomeLine,
        'tokens': {
          'primary': {
            'DEFAULT': toHex(primaryColor),
            for (final step in rampSteps) '$step': toHex(ramp[step]!),
          },
          'onPrimary': toHex(onPrimary),
        },
      };

  static String? _nonEmpty(String? value) {
    final trimmed = value?.trim();
    return trimmed == null || trimmed.isEmpty ? null : trimmed;
  }

  /// `#RRGGBB` (what the backend emits) to an opaque [Color]; null for
  /// anything else, so a malformed value never paints a wrong colour.
  static Color? parseHexColor(String? hex) {
    if (hex == null) return null;
    final match = RegExp(r'^#?([0-9a-fA-F]{6})$').firstMatch(hex.trim());
    if (match == null) return null;
    return Color(0xFF000000 | int.parse(match.group(1)!, radix: 16));
  }

  static String toHex(Color color) {
    final rgb = color.toARGB32() & 0xFFFFFF;
    return '#${rgb.toRadixString(16).padLeft(6, '0').toUpperCase()}';
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    if (other is! TenantBranding) return false;
    if (other.enabled != enabled ||
        other.displayName != displayName ||
        other.logoUrl != logoUrl ||
        other.primaryColor != primaryColor ||
        other.welcomeLine != welcomeLine ||
        other.onPrimary != onPrimary) {
      return false;
    }
    for (final step in rampSteps) {
      if (other.ramp[step] != ramp[step]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(enabled, displayName, logoUrl, primaryColor, welcomeLine, onPrimary);
}
