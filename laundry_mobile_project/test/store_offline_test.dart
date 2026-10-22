import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:laundry_mobile/models/laundry_models.dart';
import 'package:laundry_mobile/state/laundry_store.dart';

const _python = String.fromEnvironment('LAUNDRY_PYTHON');
const _serverRoot = String.fromEnvironment('LAUNDRY_SERVER_ROOT');

int _port = 5601;
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
  // python المُشغّل داخل .venv قد يترك عملية ابن حقيقية؛ نقتل الشجرة كاملة.
  await Process.run('taskkill', <String>['/PID', '${_server.pid}', '/T', '/F']);
  await _server.exitCode.timeout(const Duration(seconds: 10), onTimeout: () => -9);
  await Future<void>.delayed(const Duration(milliseconds: 400));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('دورة offline-first: حفظ محلي ثم رفع تلقائي بعد عودة الاتصال', () async {
    // flutter_test يحجب طلبات HTTP الحقيقية؛ بإعادة ضبط الـ override نسمح بها.
    HttpOverrides.global = null;
    SharedPreferences.setMockInitialValues(<String, Object>{});
    _tempDir = Directory.systemTemp.createTempSync('laundry_store_it_');
    final dbPath = '${_tempDir.path}/store.db';
    await _startServer(dbPath);
    addTearDown(() async {
      await _stopServer();
      if (_tempDir.existsSync()) _tempDir.deleteSync(recursive: true);
    });

    final store = LaundryStore();
    await Future<void>.delayed(const Duration(milliseconds: 300));
    await store.setBaseUrl('http://127.0.0.1:$_port');
    final error = await store.login('admin', 'Admin@12345');
    expect(error, isNull, reason: 'فشل تسجيل الدخول');
    expect(store.isOnline, isTrue);
    expect(store.employees, isNotEmpty);

    // تجهيز موظف وخدمة بسعر محدد (البيانات الافتراضية بلا أسعار).
    expect(
      await store.saveEmployee(employeeCode: 'IT-EMP', name: 'موظف اختبار'),
      isNull,
    );
    expect(
      await store.saveServiceItem(code: 'IT_WASH', name: 'غسل اختبار', unit: 'كيلوجرام', rate: 500),
      isNull,
    );
    final employee = store.employees.firstWhere((e) => e.employeeCode == 'IT-EMP');
    final service = store.serviceItems.firstWhere((s) => s.code == 'IT_WASH');

    // 1) أوقف الخادم لمحاكاة انقطاع الشبكة.
    await _stopServer();
    final offlineResult = await store.createOrder(
      employeeId: employee.id,
      serviceDate: '2026-10-22',
      lines: <PendingOrderLine>[
        PendingOrderLine(
          serviceItemId: service.id,
          quantity: 2,
          itemName: service.name,
          unit: service.unit,
          unitPrice: service.rate,
        ),
      ],
    );
    expect(offlineResult.ok, isTrue, reason: 'يجب حفظ الطلب محلياً: ${offlineResult.error}');
    expect(offlineResult.message, contains('الجهاز'));
    expect(store.pendingOrders, hasLength(1));
    expect(store.hasPendingUploads, isTrue);

    // 2) أعد الخادم وشغّل المزامنة.
    await _startServer(dbPath);
    await store.setBaseUrl('http://127.0.0.1:$_port');
    await store.syncNow();

    expect(store.pendingOrders, isEmpty, reason: 'يجب رفع الطلب المعلّق ومسح الطابور');
    expect(store.orders, isNotEmpty);
    final uploaded = store.orders.firstWhere(
      (o) => o.serviceDate == '2026-10-22' && o.employeeId == employee.id,
      orElse: () => throw StateError('الطلب المرفوع غير موجود'),
    );
    expect(uploaded.items, isNotEmpty);
    expect(uploaded.subtotal, closeTo(service.rate * 2, 0.001));
  }, timeout: const Timeout(Duration(minutes: 3)));

  test('الصلاحيات تتبع الدور', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final store = LaundryStore();
    expect(store.canCreateOrder, isFalse);
    expect(store.canApprove, isFalse);
    expect(store.availableTabs, isNotEmpty);
  });
}
