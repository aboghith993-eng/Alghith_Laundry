import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:laundry_mobile/config/app_config.dart';
import 'package:laundry_mobile/state/laundry_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('الدخول دون اتصال يستخدم الحساب المحفوظ ولا يخرج عند المزامنة', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      AppConfig.offlineProfilePrefsKey: jsonEncode(<String, dynamic>{
        'id': 1,
        'username': 'admin',
        'full_name': 'مدير النظام',
        'role': 'admin',
        'active': true,
      }),
      AppConfig.cachePrefsKey: jsonEncode(<String, dynamic>{'version': 1}),
    });

    final store = LaundryStore();
    await Future<void>.delayed(const Duration(milliseconds: 400));

    expect(store.canLoginOffline, isTrue);
    expect(store.offlineUser?.username, 'admin');
    expect(store.isLoggedIn, isFalse);

    final error = await store.loginOffline();
    expect(error, isNull, reason: 'يجب أن ينجح الدخول دون اتصال بالحساب المحفوظ');
    expect(store.isLoggedIn, isTrue);
    expect(store.token, isNull, reason: 'جلسة عدم الاتصال بلا رمز');
    expect(store.isOnline, isFalse);

    // المزامنة دون رمز يجب ألا تُطلق 401 ولا تُخرج المستخدم.
    await store.syncNow();
    expect(store.isLoggedIn, isTrue, reason: 'المزامنة دون رمز يجب ألا تُخرج المستخدم');
    expect(store.lastSyncError, contains('عدم الاتصال'));

    // بعد تسجيل الخروج يبقى الحساب المحفوظ متاحاً للدخول دون اتصال مجدداً.
    await store.logout();
    expect(store.isLoggedIn, isFalse);
    expect(store.canLoginOffline, isTrue);
  });

  test('بدون حساب محفوظ لا يمكن الدخول دون اتصال', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});

    final store = LaundryStore();
    await Future<void>.delayed(const Duration(milliseconds: 300));

    expect(store.canLoginOffline, isFalse);
    final error = await store.loginOffline();
    expect(error, isNotNull);
    expect(store.isLoggedIn, isFalse);
  });
}
