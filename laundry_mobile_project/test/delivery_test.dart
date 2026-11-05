import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:laundry_mobile/config/app_config.dart';
import 'package:laundry_mobile/state/laundry_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('نتيجة التسليم تحدّث الكميات المستلمة محلياً وتسمح بالاستلام على دفعات', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      AppConfig.cachePrefsKey: jsonEncode(<String, dynamic>{
        'version': 1,
        // وجود بيانات أساسية يمنع استبدال الذاكرة بالكشف المدمج عند الإقلاع.
        'employees': <Map<String, dynamic>>[
          <String, dynamic>{'id': 1, 'employee_code': 'E1', 'name': 'موظف اختبار', 'active': true},
        ],
        'service_items': <Map<String, dynamic>>[
          <String, dynamic>{'id': 1, 'code': 'X', 'name': 'خدمة', 'unit': 'قطعة', 'rate': 10.0, 'active': true},
        ],
        'orders': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 10,
            'employee_id': 1,
            'employee_code': 'E1',
            'employee_name': 'موظف اختبار',
            'service_date': '2026-11-01',
            'status': 'pending',
            'fulfillment_status': 'received',
            'subtotal': 80.0,
            'items': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 101,
                'item_name': 'بطانية',
                'unit': 'قطعة',
                'quantity': 5.0,
                'unit_price': 10.0,
                'line_total': 50.0,
              },
              <String, dynamic>{
                'id': 102,
                'item_name': 'مخدة',
                'unit': 'قطعة',
                'quantity': 3.0,
                'unit_price': 10.0,
                'line_total': 30.0,
              },
            ],
          },
        ],
      }),
    });

    final store = LaundryStore();
    await Future<void>.delayed(const Duration(milliseconds: 400));

    var order = store.orders.first;
    expect(order.remainingTotal, 8);
    expect(order.hasRemainingPieces, isTrue);

    // دفعة أولى: 2 بطانية + 1 مخدة.
    store.applyDeliveryResult(10, <String, dynamic>{
      'fulfillment_status': 'delivered',
      'items': <Map<String, dynamic>>[
        <String, dynamic>{'id': 101, 'quantity': 5.0, 'received_quantity': 2.0},
        <String, dynamic>{'id': 102, 'quantity': 3.0, 'received_quantity': 1.0},
      ],
    });

    order = store.orders.first;
    expect(order.items.firstWhere((i) => i.id == 101).receivedQuantity, 2.0);
    expect(order.remainingTotal, 5.0);
    expect(order.isPartiallyReceived, isTrue);

    // دفعة ثانية: بقية القطع.
    store.applyDeliveryResult(10, <String, dynamic>{
      'fulfillment_status': 'delivered',
      'items': <Map<String, dynamic>>[
        <String, dynamic>{'id': 101, 'quantity': 5.0, 'received_quantity': 5.0},
        <String, dynamic>{'id': 102, 'quantity': 3.0, 'received_quantity': 3.0},
      ],
    });

    order = store.orders.first;
    expect(order.remainingTotal, 0);
    expect(order.hasRemainingPieces, isFalse);
    expect(order.isPartiallyReceived, isFalse);
  });
}
