import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/app_config.dart';
import '../models/laundry_models.dart';
import '../services/laundry_api.dart';
import '../utils/format.dart';

/// نتيجة حفظ الطلب: إما نجاح (مع تنبيهات اختيارية) أو رسالة خطأ.
class OrderSaveResult {
  const OrderSaveResult.success({this.message, this.warnings = const <String>[]})
      : ok = true,
        error = null;

  const OrderSaveResult.error(this.error) : ok = false, message = null, warnings = const <String>[];

  final bool ok;
  final String? message;
  final String? error;
  final List<String> warnings;
}

/// حالة التطبيق المشتركة: الجلسة، البيانات المحلية، والمزامنة مع الخادم.
///
/// السلوك: الخادم هو المصدر الموثوق، والبيانات تُخزَّن محلياً كذاكرة مؤقتة
/// للعرض دون اتصال، والطلبات المُنشأة دون اتصال تُرفع تلقائياً عند توفّر الاتصال
/// (بمعرّف `client_uuid` يمنع التكرار).
class LaundryStore extends ChangeNotifier {
  LaundryStore() {
    _init();
  }

  // ---- الاتصال ----
  LaundryApi? _api;
  bool _online = false;
  bool _syncing = false;
  bool _syncInFlight = false;
  String? _lastSyncError;
  String _baseUrl = AppConfig.defaultBaseUrl;
  Timer? _syncTimer;

  String get baseUrl => _baseUrl;
  bool get isOnline => _online;
  bool get isSyncing => _syncing;
  String? get lastSyncError => _lastSyncError;

  // ---- الجلسة ----
  AppUser? currentUser;
  String? _token;

  bool get isLoggedIn => currentUser != null;
  String? get token => _token;

  // ---- البيانات ----
  final List<Employee> employees = <Employee>[];
  final List<ServiceItem> serviceItems = <ServiceItem>[];
  final List<AppUser> users = <AppUser>[];
  final List<LaundryOrder> orders = <LaundryOrder>[];
  final List<PendingOrder> pendingOrders = <PendingOrder>[];
  final Map<String, String> settings = <String, String>{};

  bool _restored = false;
  bool get hasRestoredCache => _restored;

  String get currency => settings['currency'] ?? 'ريال يمني';
  String get companyName => settings['company_name'] ?? 'مغسلة الشركة';

  bool get hasPendingUploads => pendingOrders.isNotEmpty;

  /// الصلاحيات مشتقة من الدور المسجّل في الخادم.
  bool get canCreateOrder => currentUser?.canCreateOrder ?? false;
  bool get canApprove => currentUser?.canApprove ?? false;
  bool get canManageEmployees => currentUser?.canManageEmployees ?? false;
  bool get canManageSystem => currentUser?.canManageSystem ?? false;

  /// التبويبات المتاحة حسب الدور (نفس قائمة القائم الجانبي في الويب).
  List<AppTab> get availableTabs {
    final tabs = <AppTab>[
      AppTab.dashboard,
      AppTab.orders,
      if (canManageEmployees) AppTab.employees,
      AppTab.reports,
      AppTab.more,
    ];
    return tabs;
  }

  Future<void> _init() async {
    await _restoreSession();
    await _restoreCache();
    await _loadBaseUrl();
    _api = LaundryApi(baseUrl: _baseUrl, token: _token);
    if (_token != null && currentUser != null) {
      final healthy = await _api!.checkHealth();
      _online = healthy;
      notifyListeners();
      if (healthy) {
        _startSyncTimer();
        await syncNow();
      }
    }
  }

  // ---- التخزين المحلي ----

  Future<void> _loadBaseUrl() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(AppConfig.baseUrlPrefsKey);
      if (saved != null && saved.trim().isNotEmpty) _baseUrl = saved.trim();
    } catch (_) {}
  }

  /// يضبط عنوان الخادم (يُحفظ على الجهاز) ويعيد الاتصال.
  Future<void> setBaseUrl(String url) async {
    final normalized = url.trim();
    if (normalized.isEmpty) return;
    _baseUrl = normalized;
    _api = LaundryApi(baseUrl: _baseUrl, token: _token);
    _online = false;
    _lastSyncError = null;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(AppConfig.baseUrlPrefsKey, _baseUrl);
    } catch (_) {}
    final healthy = await _api!.checkHealth();
    _online = healthy;
    if (healthy) {
      _startSyncTimer();
      await syncNow();
    } else {
      _lastSyncError = 'تعذّر الاتصال بالخادم على العنوان: $_baseUrl';
    }
    notifyListeners();
  }

  Future<void> _restoreSession() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(AppConfig.sessionPrefsKey);
      if (raw == null || raw.isEmpty) return;
      final data = jsonDecode(raw) as Map<String, dynamic>;
      _token = data['token']?.toString();
      final userJson = data['user'];
      if (userJson is Map) {
        currentUser = AppUser.fromJson(userJson.cast<String, dynamic>());
      }
    } catch (_) {}
  }

  Future<void> _persistSession() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (currentUser == null || _token == null) {
        await prefs.remove(AppConfig.sessionPrefsKey);
        return;
      }
      await prefs.setString(
        AppConfig.sessionPrefsKey,
        jsonEncode({'token': _token, 'user': currentUser!.toJson()}),
      );
    } catch (_) {}
  }

  Future<void> _restoreCache() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(AppConfig.cachePrefsKey);
      if (raw == null || raw.isEmpty) return;
      final data = jsonDecode(raw) as Map<String, dynamic>;
      _applySnapshot(data, persist: false);
      _restored = true;
      notifyListeners();
    } catch (_) {}
  }

  Future<void> _persistCache() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(AppConfig.cachePrefsKey, jsonEncode(_snapshotJson()));
    } catch (_) {}
  }

  Map<String, dynamic> _snapshotJson() => {
        'version': 1,
        'employees': employees.map((e) => e.toJson()).toList(),
        'service_items': serviceItems.map((e) => e.toJson()).toList(),
        'users': users.map((e) => e.toJson()).toList(),
        'orders': orders.map((e) => e.toJson()).toList(),
        'pending_orders': pendingOrders.map((e) => e.toJson()).toList(),
        'settings': settings,
      };

  void _applySnapshot(Map<String, dynamic> data, {bool persist = true, bool preservePending = false}) {
    List<Map<String, dynamic>> listOf(String key) =>
        ((data[key] as List?) ?? const [])
            .map((e) => (e as Map).cast<String, dynamic>())
            .toList();

    employees
      ..clear()
      ..addAll(listOf('employees').map(Employee.fromJson));
    serviceItems
      ..clear()
      ..addAll(listOf('service_items').map(ServiceItem.fromJson));
    users
      ..clear()
      ..addAll(listOf('users').map(AppUser.fromJson));
    final loadedOrders =
        listOf('orders').map(LaundryOrder.fromJson).toList();
    orders
      ..clear()
      ..addAll(loadedOrders);
    if (!preservePending) {
      pendingOrders
        ..clear()
        ..addAll(listOf('pending_orders').map(PendingOrder.fromJson));
    }

    final rawSettings = (data['settings'] as Map?) ?? const {};
    settings
      ..clear()
      ..addAll(rawSettings.map((key, value) => MapEntry(key.toString(), value.toString())));
    if (persist) unawaited(_persistCache());
  }

  // ---- المزامنة ----

  void _startSyncTimer() {
    _syncTimer?.cancel();
    _syncTimer = Timer.periodic(AppConfig.syncInterval, (_) => syncNow());
  }

  /// مزامنة كاملة: رفع الطلبات المعلّقة ثم جلب اللقطة من الخادم.
  Future<void> syncNow() async {
    if (_syncInFlight || _api == null || currentUser == null) return;
    _syncInFlight = true;
    _syncing = true;
    notifyListeners();
    try {
      if (!_online) {
        _online = await _api!.checkHealth();
        if (_online) {
          _startSyncTimer();
        } else {
          _lastSyncError = 'تعذّر الاتصال بالخادم';
          return;
        }
      }
      await _flushPendingUploads();
      final data = await _api!.fetchSnapshot();
      _applySnapshot(data, preservePending: true);
      _lastSyncError = null;
      _online = true;
    } on ApiException catch (e) {
      if (e.statusCode == 401) {
        await logout();
      } else {
        _lastSyncError = e.message;
        // فشل شبكي (بلا رمز حالة) => نحن دون اتصال فعلياً.
        if (e.statusCode == null) _online = false;
      }
    } catch (e) {
      _lastSyncError = e.toString();
    } finally {
      _syncing = false;
      _syncInFlight = false;
      notifyListeners();
    }
  }

  Future<void> _flushPendingUploads() async {
    if (pendingOrders.isEmpty) return;
    final payload = pendingOrders.map((o) => o.toApiJson()).toList();
    final result = await _api!.syncOrders(payload);
    final results = ((result['results'] as List?) ?? const [])
        .map((e) => (e as Map).cast<String, dynamic>())
        .toList();
    final failed = <PendingOrder>[];
    for (var i = 0; i < pendingOrders.length; i++) {
      final item = i < results.length ? results[i] : const <String, dynamic>{};
      final status = item['status']?.toString();
      if (status == 'created' || status == 'duplicate') continue;
      failed.add(pendingOrders[i]);
    }
    pendingOrders
      ..clear()
      ..addAll(failed);
    if (failed.isEmpty) {
      // الطلبات نجحت — أعد جلب البيانات الكاملة لتظهر الأرقام الحقيقية.
      final data = await _api!.fetchSnapshot();
      _applySnapshot(data, preservePending: true);
    } else {
      await _persistCache();
    }
  }

  // ---- الدخول والخروج ----

  /// تسجيل دخول عبر الخادم. يعيد null عند النجاح أو رسالة خطأ.
  Future<String?> login(String username, String password) async {
    _lastSyncError = null;
    try {
      _api ??= LaundryApi(baseUrl: _baseUrl);
      if (!await _api!.checkHealth()) {
        _online = false;
        _lastSyncError = 'تعذّر الاتصال بالخادم على العنوان: $_baseUrl';
        notifyListeners();
        return _lastSyncError;
      }
      _online = true;
      final result = await _api!.login(username, password);
      _token = result['access_token']?.toString();
      _api!.token = _token;
      final userJson = (result['user'] as Map).cast<String, dynamic>();
      currentUser = AppUser.fromJson(userJson);
      await _persistSession();
      _startSyncTimer();
      notifyListeners();
      await syncNow();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر تسجيل الدخول: $e';
    }
  }

  Future<void> logout() async {
    currentUser = null;
    _token = null;
    _api?.token = null;
    _syncTimer?.cancel();
    _syncTimer = null;
    _online = false;
    await _persistSession();
    notifyListeners();
  }

  // ---- الطلبات ----

  List<LaundryOrder> ordersFor({
    String from = '',
    String to = '',
    String status = 'all',
    String search = '',
  }) {
    final query = search.trim().toLowerCase();
    return orders.where((order) {
      if (from.isNotEmpty && order.serviceDate.compareTo(from) < 0) return false;
      if (to.isNotEmpty && order.serviceDate.compareTo(to) > 0) return false;
      if (status != 'all' && order.status != status) return false;
      if (query.isNotEmpty) {
        final haystack = '${order.reference} ${order.employeeName} ${order.employeeCode} ${order.personName} ${order.company} ${order.department}'.toLowerCase();
        if (!haystack.contains(query)) return false;
      }
      return true;
    }).toList();
  }

  LaundryOrder? orderById(int id) {
    for (final order in orders) {
      if (order.id == id) return order;
    }
    return null;
  }

  /// إنشاء طلب. يعيد نتيجة نجاح (قد تحمل تنبيهات) أو رسالة خطأ.
  Future<OrderSaveResult> createOrder({
    required int employeeId,
    required String serviceDate,
    required List<PendingOrderLine> lines,
    String personName = '',
    String notes = '',
  }) async {
    if (lines.isEmpty) return OrderSaveResult.error('أضف صنفاً واحداً على الأقل للطلب.');
    final employee = employees.where((e) => e.id == employeeId).firstOrNull;
    if (employee == null) {
      return OrderSaveResult.error('اختر موظفاً فعالاً من قاعدة البيانات.');
    }
    if (employee.isGeneral && personName.trim().isEmpty) {
      return OrderSaveResult.error('للسجل العام، اكتب اسم الزائر أو الضيف الفعلي.');
    }
    final uuid = generateClientUuid();
    final body = {
      'client_uuid': uuid,
      'employee_id': employeeId,
      'service_date': serviceDate,
      'person_name': personName.trim(),
      'notes': notes.trim(),
      'items': lines.map((l) => {'service_item_id': l.serviceItemId, 'quantity': l.quantity}).toList(),
    };

    if (_online && _api != null) {
      try {
        final result = await _api!.createOrder(body);
        final warnings = ((result['warnings'] as List?) ?? const [])
            .map((e) => e.toString())
            .toList();
        await syncNow();
        return OrderSaveResult.success(warnings: warnings);
      } on ApiException catch (e) {
        // فشل شبكي (بلا رمز حالة) => احفظ الطلب محلياً وارفعه لاحقاً.
        if (e.statusCode == null) {
          _online = false;
          return _enqueuePending(uuid, employeeId, serviceDate, personName, notes, lines);
        }
        return OrderSaveResult.error(e.message);
      } catch (e) {
        return OrderSaveResult.error('تعذّر حفظ الطلب: $e');
      }
    }

    // دون اتصال: احتفظ بالطلب محلياً وارفعه لاحقاً.
    return _enqueuePending(uuid, employeeId, serviceDate, personName, notes, lines);
  }

  /// حفظ الطلب في الطابور المحلي ليُرفع تلقائياً عند توفّر الاتصال.
  Future<OrderSaveResult> _enqueuePending(
    String uuid,
    int employeeId,
    String serviceDate,
    String personName,
    String notes,
    List<PendingOrderLine> lines,
  ) async {
    pendingOrders.add(PendingOrder(
      clientUuid: uuid,
      employeeId: employeeId,
      serviceDate: serviceDate,
      createdAt: DateTime.now().toIso8601String(),
      personName: personName.trim(),
      notes: notes.trim(),
      lines: lines,
    ));
    await _persistCache();
    notifyListeners();
    return OrderSaveResult.success(
      message: 'تم حفظ الطلب على الجهاز وسيُرفع تلقائياً عند توفّر الاتصال.',
    );
  }

  /// تسجيل تسليم القطع النظيفة.
  Future<String?> deliverOrder(int orderId) async {
    try {
      await _api!.deliverOrder(orderId);
      await syncNow();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر تسجيل التسليم: $e';
    }
  }

  /// اعتماد أو رفض الطلب.
  Future<String?> confirmOrder(int orderId, String decision, {String reason = ''}) async {
    try {
      await _api!.confirmOrder(orderId, decision, reason: reason);
      await syncNow();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر تنفيذ المراجعة: $e';
    }
  }

  /// حذف طلب غير معتمد.
  Future<String?> deleteOrder(int orderId) async {
    try {
      await _api!.deleteOrder(orderId);
      orders.removeWhere((o) => o.id == orderId);
      await _persistCache();
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر حذف الطلب: $e';
    }
  }

  // ---- الموظفون ----

  Future<String?> saveEmployee({
    int? id,
    required String employeeCode,
    required String name,
    String company = '',
    String department = '',
    String phone = '',
    String personType = 'company',
    String notes = '',
  }) async {
    final body = {
      'employee_code': employeeCode.trim(),
      'name': name.trim(),
      'company': company.trim(),
      'department': department.trim(),
      'phone': phone.trim(),
      'person_type': personType,
      'notes': notes.trim(),
    };
    try {
      if (id == null) {
        await _api!.createEmployee(body);
      } else {
        await _api!.updateEmployee(id, body);
      }
      await syncNow();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر حفظ بيانات الموظف: $e';
    }
  }

  Future<String?> toggleEmployee(int employeeId) async {
    try {
      await _api!.toggleEmployee(employeeId);
      await syncNow();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر تحديث الحالة: $e';
    }
  }

  // ---- الخدمات والأسعار ----

  Future<String?> saveServiceItem({
    int? id,
    required String code,
    required String name,
    required String unit,
    required double rate,
  }) async {
    final body = {
      'code': code.trim().toUpperCase().replaceAll(' ', '_'),
      'name': name.trim(),
      'unit': unit.trim().isEmpty ? 'قطعة' : unit.trim(),
      'rate': rate,
    };
    try {
      if (id == null) {
        await _api!.createServiceItem(body);
      } else {
        await _api!.updateServiceItem(id, body);
      }
      await syncNow();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر حفظ الخدمة: $e';
    }
  }

  Future<String?> toggleServiceItem(int itemId) async {
    try {
      await _api!.toggleServiceItem(itemId);
      await syncNow();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر تحديث الحالة: $e';
    }
  }

  // ---- المستخدمون ----

  Future<String?> createUser({
    required String username,
    required String fullName,
    required String password,
    required String role,
  }) async {
    try {
      await _api!.createUser({
        'username': username.trim(),
        'full_name': fullName.trim(),
        'password': password,
        'role': role,
      });
      await syncNow();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر إنشاء الحساب: $e';
    }
  }

  Future<String?> resetUserPassword(int userId, String password) async {
    try {
      await _api!.resetUserPassword(userId, password);
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر تغيير كلمة المرور: $e';
    }
  }

  Future<String?> toggleUser(int userId) async {
    try {
      await _api!.toggleUser(userId);
      await syncNow();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر تحديث حالة الحساب: $e';
    }
  }

  // ---- الإعدادات ----

  Future<String?> saveSettings({required String companyName, required String currency}) async {
    try {
      await _api!.saveSettings(companyName, currency);
      settings['company_name'] = companyName.trim();
      settings['currency'] = currency.trim();
      await _persistCache();
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر حفظ الإعدادات: $e';
    }
  }

  Future<String?> changePassword(String oldPassword, String newPassword) async {
    try {
      await _api!.changePassword(oldPassword, newPassword);
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return 'تعذّر تغيير كلمة المرور: $e';
    }
  }

  // ---- مؤشرات لوحة المتابعة (محسوبة من البيانات المحلية) ----

  DashboardMetrics get metrics {
    final now = DateTime.now();
    final monthStart = '${now.year}-${now.month.toString().padLeft(2, '0')}';
    final activeEmployees =
        employees.where((e) => e.active && e.personType == 'company').length;
    final pending = orders.where((o) => o.isPending).length;
    final monthApproved = orders
        .where((o) => o.isApproved && o.serviceDate.startsWith(monthStart))
        .length;
    final monthAmount = orders
        .where((o) => o.isApproved && o.serviceDate.startsWith(monthStart))
        .fold<double>(0, (sum, o) => sum + o.subtotal);
    final monthPending = orders
        .where((o) => o.isPending && o.serviceDate.startsWith(monthStart))
        .fold<double>(0, (sum, o) => sum + o.subtotal);
    return DashboardMetrics(
      employees: activeEmployees,
      pending: pending,
      monthApproved: monthApproved,
      monthAmount: monthAmount,
      monthPendingAmount: monthPending,
    );
  }

  List<LaundryOrder> get latestOrders => orders.take(8).toList();

  @override
  void dispose() {
    _syncTimer?.cancel();
    super.dispose();
  }
}

/// تبويبات الشل الرئيسي.
enum AppTab { dashboard, orders, employees, reports, more }
