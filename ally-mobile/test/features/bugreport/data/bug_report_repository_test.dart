import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'package:ally_mobile_flutter/features/bugreport/data/bug_report_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late BugReportRepository repository;

  setUpAll(() {
    PackageInfo.setMockInitialValues(
      appName: 'Ally',
      packageName: 'com.helloally.app.dev',
      version: '1.2.3',
      buildNumber: '45',
      buildSignature: '',
    );
  });

  setUp(() {
    dio = MockDio();
    repository = BugReportRepository(dio);
    when(() => dio.post<void>(any(), data: any(named: 'data')))
        .thenAnswer((_) async => _response<void>(null));
  });

  group('createBugReport', () {
    test('posts the description plus silently-captured diagnostic context', () async {
      await repository.createBugReport('The app crashed on submit');

      final captured = verify(
        () => dio.post<void>('/product-roadmap/bug-reports', data: captureAny(named: 'data')),
      ).captured;
      final body = captured.single as Map<String, dynamic>;

      expect(body['description'], 'The app crashed on submit');
      final context = body['context'] as Map<String, dynamic>;
      expect(context['appVersion'], '1.2.3');
      expect(context, isNot(contains('screen')), reason: 'omitted entirely when not supplied');
      expect(context['os'], isNotEmpty);
      expect(context['device'], isNotEmpty);
      expect(context['clientTimestamp'], isNotEmpty);
    });

    test('includes the screen name when supplied', () async {
      await repository.createBugReport('desc', screen: 'SimulationDetailsScreen');

      final captured = verify(
        () => dio.post<void>('/product-roadmap/bug-reports', data: captureAny(named: 'data')),
      ).captured;
      final context = (captured.single as Map<String, dynamic>)['context'] as Map<String, dynamic>;

      expect(context['screen'], 'SimulationDetailsScreen');
    });
  });
}
