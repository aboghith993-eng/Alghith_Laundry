/// اختبار تكامل: عميل Flutter (lib/services/laundry_api.dart) مقابل خادم Flask الفعلي.
///
/// التشغيل:
///   dart run tool/integration_test.dart
/// مع ضبط:
///   LAUNDRY_SERVER_ROOT = مسار مجلد الخادم (يحتوي app.py)
///   LAUNDRY_PYTHON      = مسار python القابل للتنفيذ
library;

import 'dart:convert';
import 'dart:io';

import 'package:laundry_mobile/services/laundry_api.dart';

late Directory tempDir;
late Process server;
int port = 5599;
var failures = 0;

void check(String label, bool ok, [String extra = '']) {
  if (ok) {
    stdout.writeln('  OK   $label');
  } else {
    stdout.writeln('  FAIL $label $extra');
    failures++;
  }
}

Future<void> main() async {
  final serverRoot = Platform.environment['LAUNDRY_SERVER_ROOT'];
  final python = Platform.environment['LAUNDRY_PYTHON'];
  if (serverRoot == null || python == null) {
    stdout.writeln('LAUNDRY_SERVER_ROOT / LAUNDRY_PYTHON مطلوبة.');
    exitCode = 2;
    return;
  }

  tempDir = Directory.systemTemp.createTempSync('laundry_it_');
  final dbPath = '${tempDir.path}/test.db';

  server = await Process.start(
    python,
    <String>[
      '-c',
      'import os,sys\n'
          'os.environ["DATABASE_PATH"]=r"$dbPath"\n'
          'os.environ["SECRET_KEY"]="integration-secret"\n'
          'sys.path.insert(0, r"$serverRoot")\n'
          'from app import app\n'
          'app.run(host="127.0.0.1", port=$port, debug=False, use_reloader=False)\n',
    ],
    workingDirectory: serverRoot,
  );
  server.stderr.transform(utf8.decoder).listen((_) {});
  server.stdout.transform(utf8.decoder).listen((_) {});

  final api = LaundryApi(baseUrl: 'http://127.0.0.1:$port');
  if (!await _waitForServer(api)) {
    stdout.writeln('تعذر تشغيل الخادم.');
    server.kill();
    tempDir.deleteSync(recursive: true);
    exitCode = 2;
    return;
  }

  stdout.writeln('== ping ==');
  check('ping', await api.checkHealth());

  stdout.writeln('== login ==');
  final login = await api.login('admin', 'Admin@12345');
  api.token = login['access_token'] as String?;
  check('token', api.token != null);
  final user = (login['user'] as Map).cast<String, dynamic>();
  check('role admin', user['role'] == 'admin', '$user');
  final me = await api.fetchMe();
  check('me', (me['user'] as Map)['username'] == 'admin', '$me');

  stdout.writeln('== snapshot ==');
  final snapshot = await api.fetchSnapshot();
  check('employees', (snapshot['employees'] as List).isNotEmpty);
  check('service items', (snapshot['service_items'] as List).isNotEmpty);
  check('settings', (snapshot['settings'] as Map).isNotEmpty);
  check('counts', (snapshot['counts'] as Map)['employees'] is int);

  stdout.writeln('== employees ==');
  await api.createEmployee(<String, dynamic>{
    'employee_code': 'IT-001',
    'name': 'موظف اختبار',
    'company': 'شركة الاختبار',
    'department': 'إنتاج',
    'person_type': 'company',
  });
  var employees = await api.fetchEmployees();
  final target = employees.firstWhere((e) => e['employee_code'] == 'IT-001');
  final employeeId = target['id'] as int;
  check('employee listed', target['name'] == 'موظف اختبار', '$target');
  await api.toggleEmployee(employeeId);
  employees = await api.fetchEmployees();
  final toggled = employees.firstWhere((e) => e['employee_code'] == 'IT-001');
  check('toggle applied', toggled['active'] == false, '$toggled');
  await api.toggleEmployee(employeeId);

  stdout.writeln('== service items ==');
  await api.createServiceItem(<String, dynamic>{
    'code': 'IT_WASH',
    'name': 'غسل اختبار',
    'unit': 'كيلوجرام',
    'rate': 500,
  });
  final items = await api.fetchServiceItems();
  final wash = items.firstWhere((i) => i['code'] == 'IT_WASH');
  check('service item rate', (wash['rate'] as num).toDouble() == 500, '$wash');

  stdout.writeln('== orders ==');
  final orderResult = await api.createOrder(<String, dynamic>{
    'client_uuid': 'it-uuid-001',
    'employee_id': employeeId,
    'service_date': '2026-10-20',
    'notes': 'طلب تكامل',
    'items': <Map<String, dynamic>>[
      <String, dynamic>{'service_item_id': wash['id'], 'quantity': 3},
    ],
  });
  check('order created', orderResult['status'] == 'created', '$orderResult');
  final orderId = orderResult['order_id'] as int;
  check('reference', (orderResult['reference'] as String).startsWith('LND-'), '$orderResult');
  check('subtotal', (orderResult['subtotal'] as num).toDouble() == 1500, '$orderResult');

  final duplicate = await api.createOrder(<String, dynamic>{
    'client_uuid': 'it-uuid-001',
    'employee_id': employeeId,
    'service_date': '2026-10-20',
    'items': <Map<String, dynamic>>[
      <String, dynamic>{'service_item_id': wash['id'], 'quantity': 3},
    ],
  });
  check('idempotent', duplicate['status'] == 'duplicate', '$duplicate');

  final pending = await api.fetchOrders(status: 'pending');
  check('orders list', pending.any((o) => o['id'] == orderId), '${pending.length} طلب');
  final detail = await api.fetchOrders(search: 'LND-');
  check('order search', detail.isNotEmpty);
  check('order items in payload', (pending.first['items'] as List).isNotEmpty);

  await api.deliverOrder(orderId);
  var blocked = false;
  try {
    await api.deliverOrder(orderId);
  } on ApiException catch (e) {
    blocked = e.statusCode == 409;
  }
  check('double deliver blocked', blocked);

  await api.confirmOrder(orderId, 'approved');
  final approved = await api.fetchOrders(status: 'approved');
  check('approved', approved.any((o) => o['id'] == orderId));

  stdout.writeln('== bulk sync ==');
  final sync = await api.syncOrders(<Map<String, dynamic>>[
    <String, dynamic>{
      'client_uuid': 'it-uuid-002',
      'employee_id': employeeId,
      'service_date': '2026-10-21',
      'items': <Map<String, dynamic>>[
        <String, dynamic>{'service_item_id': wash['id'], 'quantity': 1},
      ],
    },
  ]);
  check('sync accepted', sync['accepted'] == 1, '$sync');

  stdout.writeln('== reports / dashboard ==');
  final reports = await api.fetchReports();
  check('reports orders', (reports['orders'] as List).isNotEmpty);
  check('reports summary', (reports['summary'] as Map).isNotEmpty);
  check('reports totals', (reports['approved_total'] as num).toDouble() >= 1500);
  final dashboard = await api.fetchDashboard();
  check('dashboard metrics', (dashboard['metrics'] as Map).isNotEmpty);
  check('dashboard latest', (dashboard['latest'] as List).isNotEmpty);

  stdout.writeln('== users / settings ==');
  final users = await api.fetchUsers();
  check('users list', users.length >= 3, '${users.length}');
  await api.createUser(<String, dynamic>{
    'username': 'it_user',
    'full_name': 'مستخدم تكامل',
    'password': 'Integration@123',
    'role': 'supervisor',
  });
  final settings = await api.fetchSettings();
  check('settings currency', (settings['currency'] ?? '').isNotEmpty, '$settings');
  await api.saveSettings('مغسلة الشركة', 'ريال يمني');

  stdout.writeln('== role enforcement ==');
  final supLogin = await api.login('it_user', 'Integration@123');
  final supApi = LaundryApi(
    baseUrl: 'http://127.0.0.1:$port',
    token: supLogin['access_token'] as String?,
  );
  var usersBlocked = false;
  try {
    await supApi.fetchUsers();
  } on ApiException catch (e) {
    usersBlocked = e.statusCode == 403;
  }
  check('supervisor blocked from users', usersBlocked);

  var orderBlocked = false;
  try {
    await supApi.createOrder(<String, dynamic>{
      'client_uuid': 'it-uuid-003',
      'employee_id': employeeId,
      'service_date': '2026-10-22',
      'items': <Map<String, dynamic>>[
        <String, dynamic>{'service_item_id': wash['id'], 'quantity': 1},
      ],
    });
  } on ApiException catch (e) {
    orderBlocked = e.statusCode == 403;
  }
  check('supervisor blocked from creating orders', orderBlocked);

  var deliverBlocked = false;
  try {
    await supApi.deliverOrder(orderId);
  } on ApiException catch (e) {
    deliverBlocked = e.statusCode == 403;
  }
  check('supervisor blocked from delivering', deliverBlocked);

  stdout.writeln('== contractor scope ==');
  final conLogin = await api.login('contractor', 'Laundry@12345');
  final conApi = LaundryApi(
    baseUrl: 'http://127.0.0.1:$port',
    token: conLogin['access_token'] as String?,
  );
  var confirmBlocked = false;
  try {
    await conApi.confirmOrder(orderId, 'approved');
  } on ApiException catch (e) {
    confirmBlocked = e.statusCode == 403;
  }
  check('contractor blocked from confirming', confirmBlocked);
  final conSnapshot = await conApi.fetchSnapshot();
  check('contractor snapshot ok', (conSnapshot['employees'] as List).isNotEmpty);

  stdout.writeln('');
  if (failures > 0) {
    stdout.writeln('FAILED $failures');
    exitCode = 1;
  } else {
    stdout.writeln('INTEGRATION TESTS PASSED');
  }

  server.kill();
  tempDir.deleteSync(recursive: true);
}

Future<bool> _waitForServer(LaundryApi api) async {
  for (var i = 0; i < 60; i++) {
    if (await api.checkHealth()) return true;
    await Future<void>.delayed(const Duration(milliseconds: 500));
  }
  return false;
}
