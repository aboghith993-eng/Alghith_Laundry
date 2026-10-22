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
const _uiTestsEnabled = bool.fromEnvironment('LAUNDRY_UI_TESTS');

int _port = 5603;
late Directory _tempDir;
Process? _server;

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
  _server!.stderr.transform(utf8.decoder).listen((_) {});
  _server!.stdout.transform(utf8.decoder).listen((_) {});
}

void _stopServerSync() {
  final server = _server;
  if (server == null) return;
  try {
    Process.runSync('taskkill', <String>['/PID', '${server.pid}', '/T', '/F']);
  } catch (_) {}
  _server = null;
  sleep(const Duration(milliseconds: 400));
}

/// ينفّذ خطوة زمنية حقيقية (شبكة/عملية) ثم يرسم إطاراً.
Future<void> _tick(WidgetTester tester, {int milliseconds = 200}) async {
  await tester.runAsync(() => Future<void>.delayed(Duration(milliseconds: milliseconds)));
  await tester.pump();
}

Future<void> _pumpUntil(WidgetTester tester, bool Function() condition, {int seconds = 40}) async {
  final end = DateTime.now().add(Duration(seconds: seconds));
  while (!condition() && DateTime.now().isBefore(end)) {
    await _tick(tester);
  }
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

Future<LaundryStore> _prepareStore(WidgetTester tester, String prefix) async {
  HttpOverrides.global = null;
  SharedPreferences.setMockInitialValues(<String, Object>{});
  _tempDir = Directory.systemTemp.createTempSync(prefix);
  final dbPath = '${_tempDir.path}/ui.db';
  await tester.runAsync(() async {
    await _startServer(dbPath);
    await Future<void>.delayed(const Duration(milliseconds: 600));
  });
  addTearDown(() {
    _stopServerSync();
    if (_tempDir.existsSync()) _tempDir.deleteSync(recursive: true);
  });
  final store = LaundryStore();
  await tester.runAsync(() async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    await store.setBaseUrl('http://127.0.0.1:$_port');
  });
  return store;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('تسجيل الدخول والتنقل بين التبويبات', (tester) async {
    final store = await _prepareStore(tester, 'laundry_ui_it_');

    await tester.pumpWidget(_app(store));
    await _tick(tester);

    // شاشة الدخول
    expect(find.text('تسجيل الدخول'), findsOneWidget);
    expect(find.text('اسم المستخدم'), findsOneWidget);
    expect(find.text('كلمة المرور'), findsOneWidget);
    expect(find.text('إعدادات الخادم'), findsNothing);

    await tester.enterText(
      find.widgetWithText(TextField, 'اسم المستخدم'),
      'admin',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'كلمة المرور'),
      'Admin@12345',
    );
    await tester.tap(find.text('تسجيل الدخول'));
    await _pumpUntil(tester, () => store.isLoggedIn && store.employees.isNotEmpty);
    await _tick(tester, milliseconds: 400);

    // لوحة المتابعة
    expect(find.text('لوحة المتابعة'), findsWidgets);
    expect(store.currentUser?.role, 'admin');
    expect(store.employees, isNotEmpty);

    // التنقل بين التبويبات
    for (final label in <String>['الطلبات', 'الموظفون', 'التقارير', 'المزيد']) {
      await tester.tap(find.text(label).last);
      await _tick(tester, milliseconds: 300);
      expect(tester.takeException(), isNull, reason: 'استثناء عند فتح تبويب $label');
    }

    expect(find.text('إدارة النظام'), findsWidgets);

    store.dispose();
  }, timeout: const Timeout(Duration(minutes: 4)), skip: !_uiTestsEnabled);

  testWidgets('رسالة الخطأ عند بيانات دخول خاطئة', (tester) async {
    final store = await _prepareStore(tester, 'laundry_ui_it2_');

    await tester.pumpWidget(_app(store));
    await _tick(tester);

    await tester.enterText(find.widgetWithText(TextField, 'اسم المستخدم'), 'admin');
    await tester.enterText(find.widgetWithText(TextField, 'كلمة المرور'), 'wrong-password');
    await tester.tap(find.text('تسجيل الدخول'));
    await _pumpUntil(
      tester,
      () => find.textContaining('غير صحيحة').evaluate().isNotEmpty,
      seconds: 20,
    );
    await _tick(tester);

    expect(store.isLoggedIn, isFalse);
    expect(find.textContaining('غير صحيحة'), findsWidgets);
  }, timeout: const Timeout(Duration(minutes: 4)), skip: !_uiTestsEnabled);
}
