import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:laundry_mobile/main.dart';
import 'package:laundry_mobile/state/laundry_store.dart';
import 'package:laundry_mobile/state/store_scope.dart';
import 'package:laundry_mobile/widgets/app_widgets.dart';

const _python = String.fromEnvironment('LAUNDRY_PYTHON');
const _serverRoot = String.fromEnvironment('LAUNDRY_SERVER_ROOT');

int _port = 5603;
late Directory _tempDir;
late Process _server;

Future<void> _startServer(String dbPath) async {
  _server = await Process.start(
    _python,
    <String>[
      '-c',
      'import os,sys\n'
          'os.environ["DATABASE_PATH"]=r"$dbPath"\n'
          'os.environ["SECRET_KEY"]="integration-secret"\n'
          'sys.path.insert(0, r"$_serverRoot")\n'
          'from app import app\n'
          'app.run(host="127.0.0.1", port=$_port, debug=False, use_reloader=False)\n',
    ],
    workingDirectory: _serverRoot,
  );
  _server.stderr.transform(utf8.decoder).listen((_) {});
  _server.stdout.transform(utf8.decoder).listen((_) {});
}

Future<void> _stopServer() async {
  await Process.run('taskkill', <String>['/PID', '${_server.pid}', '/T', '/F']);
  await _server.exitCode.timeout(const Duration(seconds: 10), onTimeout: () => -9);
  await Future<void>.delayed(const Duration(milliseconds: 400));
}

Widget _app(LaundryStore store) {
  return StoreScope(
    store: store,
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.build(),
      locale: const Locale('ar'),
      supportedLocales: const <Locale>[Locale('ar')],
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => Directionality(
        textDirection: TextDirection.rtl,
        child: child ?? const SizedBox.shrink(),
      ),
      home: const RootGate(),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('تسجيل الدخول والتنقل بين التبويبات', (tester) async {
    HttpOverrides.global = null;
    SharedPreferences.setMockInitialValues(<String, Object>{});
    _tempDir = Directory.systemTemp.createTempSync('laundry_ui_it_');
    final dbPath = '${_tempDir.path}/ui.db';
    await _startServer(dbPath);
    addTearDown(() async {
      await _stopServer();
      if (_tempDir.existsSync()) _tempDir.deleteSync(recursive: true);
    });

    final store = LaundryStore();
    await Future<void>.delayed(const Duration(milliseconds: 300));
    await store.setBaseUrl('http://127.0.0.1:$_port');

    await tester.pumpWidget(_app(store));
    await tester.pumpAndSettle();

    // شاشة الدخول
    expect(find.text('تسجيل الدخول'), findsOneWidget);
    expect(find.text('اسم المستخدم'), findsOneWidget);
    expect(find.text('كلمة المرور'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'اسم المستخدم'),
      'admin',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'كلمة المرور'),
      'Admin@12345',
    );
    await tester.tap(find.text('تسجيل الدخول'));
    await tester.pumpAndSettle(const Duration(seconds: 5));

    // لوحة المتابعة
    expect(find.text('لوحة المتابعة'), findsOneWidget);
    expect(store.isLoggedIn, isTrue);
    expect(store.currentUser?.role, 'admin');
    expect(store.employees, isNotEmpty);

    // التنقل بين التبويبات
    for (final label in <String>['الطلبات', 'الموظفون', 'التقارير', 'المزيد']) {
      await tester.tap(find.text(label).last);
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(tester.takeException(), isNull, reason: 'استثناء عند فتح تبويب $label');
    }

    expect(find.text('إدارة النظام'), findsWidgets);
  }, timeout: const Timeout(Duration(minutes: 4)));

  testWidgets('رسالة الخطأ عند بيانات دخول خاطئة', (tester) async {
    HttpOverrides.global = null;
    SharedPreferences.setMockInitialValues(<String, Object>{});
    _tempDir = Directory.systemTemp.createTempSync('laundry_ui_it2_');
    final dbPath = '${_tempDir.path}/ui.db';
    await _startServer(dbPath);
    addTearDown(() async {
      await _stopServer();
      if (_tempDir.existsSync()) _tempDir.deleteSync(recursive: true);
    });

    final store = LaundryStore();
    await Future<void>.delayed(const Duration(milliseconds: 300));
    await store.setBaseUrl('http://127.0.0.1:$_port');

    await tester.pumpWidget(_app(store));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'اسم المستخدم'), 'admin');
    await tester.enterText(find.widgetWithText(TextField, 'كلمة المرور'), 'wrong-password');
    await tester.tap(find.text('تسجيل الدخول'));
    await tester.pumpAndSettle(const Duration(seconds: 5));

    expect(store.isLoggedIn, isFalse);
    expect(find.textContaining('بيانات الدخول'), findsWidgets);
  }, timeout: const Timeout(Duration(minutes: 4)));
}
