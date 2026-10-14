import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

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

  setUp(() {
    dio = MockDio();
    repository = BugReportRepository(dio);
  });

  group('createBugReport', () {
    test('posts the description in the expected body shape', () async {
      when(() => dio.post<void>(
            '/product-roadmap/bug-reports',
            data: {'description': 'The app crashed on submit'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.createBugReport('The app crashed on submit');

      verify(() => dio.post<void>(
            '/product-roadmap/bug-reports',
            data: {'description': 'The app crashed on submit'},
          )).called(1);
    });
  });
}
