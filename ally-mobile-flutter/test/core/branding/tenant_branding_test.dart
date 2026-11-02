import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/branding/tenant_branding.dart';

Map<String, dynamic> acmeJson({bool enabled = true}) => {
      'enabled': enabled,
      'displayName': 'Acme Helpline',
      'logoUrl': 'https://assets.example/logo.png',
      'faviconUrl': null,
      'primaryColor': '#8E2626',
      'welcomeLine': 'Welcome back',
      'poweredByAlly': true,
      'tokens': {
        'primary': {
          'DEFAULT': '#8E2626',
          '50': '#F6EEEE',
          '100': '#EDDCDC',
          '200': '#DBBABA',
          '300': '#C79393',
          '400': '#AE6363',
          '500': '#8E2626',
          '600': '#741F1F',
          '700': '#591818',
          '800': '#3C1010',
          '900': '#250A0A',
        },
        'onPrimary': '#FAF9F5',
      },
    };

void main() {
  group('TenantBranding.fromJson', () {
    test('parses the resolved branding ally-be returns', () {
      final branding = TenantBranding.fromJson(acmeJson());

      expect(branding.enabled, isTrue);
      expect(branding.displayName, 'Acme Helpline');
      expect(branding.logoUrl, 'https://assets.example/logo.png');
      expect(branding.primaryColor, const Color(0xFF8E2626));
      expect(branding.welcomeLine, 'Welcome back');
      expect(branding.ramp[50], const Color(0xFFF6EEEE));
      expect(branding.ramp[600], const Color(0xFF741F1F));
      expect(branding.onPrimary, const Color(0xFFFAF9F5));
    });

    test('an org with the switch off parses as disabled', () {
      expect(TenantBranding.fromJson(acmeJson(enabled: false)).enabled, isFalse);
    });

    test('falls back to Ally on a malformed colour or an incomplete ramp', () {
      final badColour = acmeJson()..['primaryColor'] = 'red';
      expect(TenantBranding.fromJson(badColour), TenantBranding.ally);

      final missingStep = acmeJson();
      (missingStep['tokens']['primary'] as Map<String, dynamic>).remove('700');
      expect(TenantBranding.fromJson(missingStep), TenantBranding.ally);

      expect(TenantBranding.fromJson({}), TenantBranding.ally);
    });

    test('blank name and welcome line read as Ally name / no line', () {
      final json = acmeJson()
        ..['displayName'] = '  '
        ..['welcomeLine'] = '';
      final branding = TenantBranding.fromJson(json);
      expect(branding.displayName, 'Ally');
      expect(branding.welcomeLine, isNull);
    });

    test('round-trips through toJson (the cold-start cache)', () {
      final branding = TenantBranding.fromJson(acmeJson());
      expect(TenantBranding.fromJson(branding.toJson()), branding);
    });
  });

  group('parseHexColor / toHex', () {
    test('accepts #RRGGBB in either case, rejects everything else', () {
      expect(TenantBranding.parseHexColor('#264d8e'), const Color(0xFF264D8E));
      expect(TenantBranding.parseHexColor('264D8E'), const Color(0xFF264D8E));
      expect(TenantBranding.parseHexColor('#FFF'), isNull);
      expect(TenantBranding.parseHexColor('blue'), isNull);
      expect(TenantBranding.parseHexColor(null), isNull);
    });

    test('toHex writes the backend form', () {
      expect(TenantBranding.toHex(const Color(0xFF0A1425)), '#0A1425');
    });
  });
}
