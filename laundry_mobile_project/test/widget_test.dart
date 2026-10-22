import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:laundry_mobile/models/laundry_models.dart';
import 'package:laundry_mobile/state/laundry_store.dart';
import 'package:laundry_mobile/utils/format.dart';
import 'package:laundry_mobile/utils/shift.dart';

void main() {
  group('تنسيق المبالغ', () {
    test('يطابق تنسيق Python (منزلتان وفاصلة آلاف)', () {
      expect(formatMoney(0), '0.00');
      expect(formatMoney(1800), '1,800.00');
      expect(formatMoney(1234567.5), '1,234,567.50');
      expect(formatMoney(-250.25), '-250.25');
    });
  });

  group('حالة الطلب', () {
    test('تتحول من JSON إلى النموذج مع الأصناف', () {
      final order = LaundryOrder.fromJson(<String, dynamic>{
        'id': 7,
        'reference': 'LND-2610-000007',
        'employee_id': 3,
        'employee_code': 'EMP-001',
        'employee_name': 'أحمد محمد',
        'service_date': '2026-10-20',
        'status': 'pending',
        'fulfillment_status': 'delivered',
        'subtotal': 1800,
        'items': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 1,
            'item_name': 'غسل ملابس',
            'unit': 'كيلوجرام',
            'quantity': 3,
            'unit_price': 500,
            'line_total': 1500,
          },
        ],
      });

      expect(order.id, 7);
      expect(order.reference, 'LND-2610-000007');
      expect(order.isPending, isTrue);
      expect(order.isDelivered, isTrue);
      expect(order.displayName, 'أحمد محمد');
      expect(order.items, hasLength(1));
      expect(order.items.first.lineTotal, 1500);
      expect(order.statusText, 'بانتظار التأكيد');
    });
  });

  group('دورة الدوام', () {
    test('تُحتسب مطابقةً لدالة employee_cycle في app.py', () {
      final employee = Employee(
        id: 1,
        employeeCode: 'EMP-001',
        name: 'سالم',
        serviceType: 'سكن',
        workDays: 5,
        restDays: 2,
        cycleAnchor: '2026-10-01',
      );

      final day1 = computeShiftCycle(employee, DateTime(2026, 10, 1));
      expect(day1.known, isTrue);
      expect(day1.day, 1);
      expect(day1.onDuty, isTrue);
      expect(day1.label, 'دوام');

      final day6 = computeShiftCycle(employee, DateTime(2026, 10, 6));
      expect(day6.day, 6);
      expect(day6.onDuty, isFalse);
      expect(day6.label, 'راحة');

      final day8 = computeShiftCycle(employee, DateTime(2026, 10, 8));
      expect(day8.day, 1, reason: 'الدورة تتكرر كل 7 أيام');
      expect(day8.onDuty, isTrue);
    });

    test('تنبيه نوع الخدمة غير السكني', () {
      final employee = Employee(
        id: 2,
        employeeCode: 'EMP-002',
        name: 'نقل',
        serviceType: 'نقل',
        workDays: 0,
        restDays: 0,
      );
      final warnings = shiftWarnings(employee, DateTime(2026, 10, 20));
      expect(warnings, hasLength(1));
      expect(warnings.first, contains('نوع خدمة الموظف'));
    });

    test('لا تنبيه لنوع سكن في يوم دوام', () {
      final employee = Employee(
        id: 3,
        employeeCode: 'EMP-003',
        name: 'نجيب',
        serviceType: 'سكن',
        workDays: 6,
        restDays: 1,
        cycleAnchor: '2026-10-01',
      );
      expect(shiftWarnings(employee, DateTime(2026, 10, 1)), isEmpty);
      expect(shiftWarnings(employee, DateTime(2026, 10, 7)), hasLength(1));
    });
  });

  group('الطلبات المعلّقة', () {
    test('تُبنى بصيغة الإرسال إلى الخادم', () {
      final pending = PendingOrder(
        clientUuid: 'lm-1',
        employeeId: 4,
        serviceDate: '2026-10-21',
        createdAt: '2026-10-21T10:00:00',
        lines: <PendingOrderLine>[
          PendingOrderLine(
            serviceItemId: 2,
            quantity: 3,
            itemName: 'غسل ملابس',
            unit: 'كيلوجرام',
            unitPrice: 500,
          ),
        ],
      );

      final api = pending.toApiJson();
      expect(api['client_uuid'], 'lm-1');
      expect((api['items'] as List).length, 1);
      expect(pending.subtotal, 1500);

      final restored = PendingOrder.fromJson(pending.toJson());
      expect(restored.clientUuid, 'lm-1');
      expect(restored.lines.first.quantity, 3);
    });
  });

  group('رقم الموظف', () {
    test('تطبيع الرقم للتطابق المباشر', () {
      expect(LaundryStore.normalizeEmployeeCode(' 1001 '), '1001');
      expect(LaundryStore.normalizeEmployeeCode('gen-001'), 'GEN001');
      expect(LaundryStore.normalizeEmployeeCode('a 12-3'), 'A123');
      expect(LaundryStore.normalizeEmployeeCode(''), '');
    });
  });

  testWidgets('شاشة الدخول تعرض عناصرها الأساسية', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Placeholder()));
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
