import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';

/// استثناء يحمل رسالة خطأ عربية قابلة للعرض للمستخدم.
class ApiException implements Exception {
  ApiException(this.message, [this.statusCode]);
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

/// عميل REST يتصل بخادم Flask الذي يقدّم تطبيق الويب.
class LaundryApi {
  LaundryApi({String? baseUrl, this.token})
      : baseUrl = _normalize(baseUrl ?? AppConfig.defaultBaseUrl);

  final String baseUrl;
  String? token;

  static String _normalize(String url) {
    var value = url.trim();
    while (value.endsWith('/')) {
      value = value.substring(0, value.length - 1);
    }
    if (value.endsWith('/api')) {
      value = value.substring(0, value.length - 4);
    }
    return value;
  }

  /// اختبار الوصول للخادم.
  Future<bool> checkHealth() async {
    try {
      await _request('GET', '/api/mobile/ping');
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>> login(String username, String password) async {
    final data = await _request('POST', '/api/auth/login', body: {
      'username': username,
      'password': password,
    });
    return (data as Map).cast<String, dynamic>();
  }

  Future<Map<String, dynamic>> fetchMe() async {
    final data = await _request('GET', '/api/auth/me');
    return (data as Map).cast<String, dynamic>();
  }

  /// لقطة كاملة للبيانات (تعمل دون اتصال).
  Future<Map<String, dynamic>> fetchSnapshot() async {
    final data = await _request('GET', '/api/mobile/snapshot');
    return (data as Map).cast<String, dynamic>();
  }

  Future<Map<String, dynamic>> fetchDashboard() async {
    final data = await _request('GET', '/api/dashboard');
    return (data as Map).cast<String, dynamic>();
  }

  Future<List<Map<String, dynamic>>> fetchOrders({
    String from = '',
    String to = '',
    String status = '',
    String search = '',
  }) async {
    final query = <String, String>{
      if (from.isNotEmpty) 'from': from,
      if (to.isNotEmpty) 'to': to,
      if (status.isNotEmpty) 'status': status,
      if (search.isNotEmpty) 'q': search,
    };
    final suffix = query.isEmpty ? '' : '?${Uri(queryParameters: query).query}';
    final data = await _request('GET', '/api/orders$suffix');
    return _listOf(data, 'orders');
  }

  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> body) async {
    final data = await _request('POST', '/api/orders', body: body);
    return (data as Map).cast<String, dynamic>();
  }

  Future<Map<String, dynamic>> syncOrders(List<Map<String, dynamic>> orders) async {
    final data = await _request('POST', '/api/sync/orders', body: {'orders': orders});
    return (data as Map).cast<String, dynamic>();
  }

  Future<void> deliverOrder(int orderId) async {
    await _request('POST', '/api/orders/$orderId/deliver');
  }

  Future<void> confirmOrder(int orderId, String decision, {String reason = ''}) async {
    await _request('POST', '/api/orders/$orderId/confirm', body: {
      'decision': decision,
      'rejection_reason': reason,
    });
  }

  Future<void> deleteOrder(int orderId) async {
    await _request('DELETE', '/api/orders/$orderId');
  }

  Future<List<Map<String, dynamic>>> fetchEmployees({
    String search = '',
    String type = 'all',
    String service = 'all',
  }) async {
    final query = <String, String>{
      if (search.isNotEmpty) 'q': search,
      if (type.isNotEmpty && type != 'all') 'type': type,
      if (service.isNotEmpty && service != 'all') 'service': service,
    };
    final suffix = query.isEmpty ? '' : '?${Uri(queryParameters: query).query}';
    final data = await _request('GET', '/api/employees$suffix');
    return _listOf(data, 'employees');
  }

  Future<void> createEmployee(Map<String, dynamic> body) async {
    await _request('POST', '/api/employees', body: body);
  }

  Future<void> updateEmployee(int employeeId, Map<String, dynamic> body) async {
    await _request('POST', '/api/employees/$employeeId', body: body);
  }

  Future<void> toggleEmployee(int employeeId) async {
    await _request('POST', '/api/employees/$employeeId/toggle');
  }

  Future<List<Map<String, dynamic>>> fetchServiceItems() async {
    final data = await _request('GET', '/api/service-items');
    return _listOf(data, 'service_items');
  }

  Future<void> createServiceItem(Map<String, dynamic> body) async {
    await _request('POST', '/api/service-items', body: body);
  }

  Future<void> updateServiceItem(int itemId, Map<String, dynamic> body) async {
    await _request('POST', '/api/service-items/$itemId', body: body);
  }

  Future<void> toggleServiceItem(int itemId) async {
    await _request('POST', '/api/service-items/$itemId/toggle');
  }

  Future<Map<String, dynamic>> fetchReports({
    String from = '',
    String to = '',
    String status = 'all',
    String search = '',
  }) async {
    final query = <String, String>{
      if (from.isNotEmpty) 'from': from,
      if (to.isNotEmpty) 'to': to,
      if (status.isNotEmpty) 'status': status,
      if (search.isNotEmpty) 'q': search,
    };
    final suffix = query.isEmpty ? '' : '?${Uri(queryParameters: query).query}';
    final data = await _request('GET', '/api/reports$suffix');
    return (data as Map).cast<String, dynamic>();
  }

  Future<List<Map<String, dynamic>>> fetchUsers() async {
    final data = await _request('GET', '/api/users');
    return _listOf(data, 'users');
  }

  Future<void> createUser(Map<String, dynamic> body) async {
    await _request('POST', '/api/users', body: body);
  }

  Future<void> resetUserPassword(int userId, String password) async {
    await _request('POST', '/api/users/$userId/reset', body: {'password': password});
  }

  Future<void> toggleUser(int userId) async {
    await _request('POST', '/api/users/$userId/toggle');
  }

  Future<Map<String, String>> fetchSettings() async {
    final data = await _request('GET', '/api/settings');
    final raw = (data['settings'] as Map?) ?? const {};
    return raw.map((key, value) => MapEntry(key.toString(), value.toString()));
  }

  Future<void> saveSettings(String companyName, String currency) async {
    await _request('POST', '/api/settings', body: {
      'company_name': companyName,
      'currency': currency,
    });
  }

  Future<void> changePassword(String oldPassword, String newPassword) async {
    await _request('POST', '/api/account/password', body: {
      'old_password': oldPassword,
      'new_password': newPassword,
      'confirm_password': newPassword,
    });
  }

  static List<Map<String, dynamic>> _listOf(dynamic data, String key) {
    final list = ((data as Map)[key] as List?) ?? const [];
    return list.map((e) => (e as Map).cast<String, dynamic>()).toList();
  }

  Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('$baseUrl${path.startsWith('/') ? path : '/$path'}');
    final headers = <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      if (token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
    };
    final encoded = body != null ? jsonEncode(body) : null;
    try {
      late http.Response response;
      switch (method) {
        case 'POST':
          response = await http
              .post(uri, headers: headers, body: encoded)
              .timeout(AppConfig.apiTimeout);
          break;
        case 'PUT':
          response = await http
              .put(uri, headers: headers, body: encoded)
              .timeout(AppConfig.apiTimeout);
          break;
        case 'DELETE':
          response = await http
              .delete(uri, headers: headers, body: encoded)
              .timeout(AppConfig.apiTimeout);
          break;
        default:
          response = await http.get(uri, headers: headers).timeout(AppConfig.apiTimeout);
      }
      final responseText = utf8.decode(response.bodyBytes, allowMalformed: true);
      final decoded = responseText.trim().isEmpty ? null : _tryDecode(responseText);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final message = decoded is Map && decoded['error'] != null
            ? decoded['error'].toString()
            : 'تعذّر تنفيذ العملية (رمز ${response.statusCode})';
        throw ApiException(message, response.statusCode);
      }
      return decoded;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiException(
        'الخادم يستغرق وقتاً في الاستيقاظ (الخطة المجانية). أعد المحاولة بعد لحظات',
      );
    } on FormatException {
      throw ApiException('رد غير مفهوم من الخادم');
    } catch (_) {
      throw ApiException('تعذّر الاتصال بالخادم — تحقق من الشبكة وعنوان الخادم');
    }
  }

  dynamic _tryDecode(String text) {
    try {
      return jsonDecode(text);
    } catch (_) {
      return null;
    }
  }
}
