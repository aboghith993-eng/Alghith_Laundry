/// نماذج البيانات لتطبيق نظام مغسلة الشركة.
///
/// تطابق أعمدة جداول الخادم (users, employees, service_items, laundry_orders,
/// laundry_order_items, settings) كما هي في `app.py`.
library;

class AppUser {
  AppUser({
    required this.id,
    required this.username,
    required this.fullName,
    required this.role,
    required this.active,
    this.roleLabel = '',
  });

  final int id;
  final String username;
  final String fullName;
  final String role;
  final String roleLabel;
  final bool active;

  bool get isAdmin => role == 'admin';
  bool get isSupervisor => role == 'supervisor';
  bool get isContractor => role == 'contractor';

  /// يمكن إنشاء الطلبات وتسجيل التسليم.
  bool get canCreateOrder => role == 'admin' || role == 'contractor';

  /// يمكن مراجعة واعتماد الطلبات.
  bool get canApprove => role == 'admin' || role == 'supervisor';

  /// يمكن إدارة قاعدة الموظفين.
  bool get canManageEmployees => role == 'admin' || role == 'supervisor';

  /// يمكن إدارة الخدمات والأسعار والمستخدمين والإعدادات.
  bool get canManageSystem => role == 'admin';

  static AppUser fromJson(Map<String, dynamic> json) => AppUser(
        id: _toInt(json['id']),
        username: _toStr(json['username']),
        fullName: _toStr(json['full_name'] ?? json['fullName']),
        role: _toStr(json['role']),
        roleLabel: _toStr(json['role_label'] ?? json['roleLabel']),
        active: _toBool(json['active'], fallback: true),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'username': username,
        'full_name': fullName,
        'role': role,
        'role_label': roleLabel,
        'active': active,
      };
}

class Employee {
  Employee({
    required this.id,
    required this.employeeCode,
    required this.name,
    this.company = '',
    this.department = '',
    this.phone = '',
    this.personType = 'company',
    this.active = true,
    this.notes = '',
    this.serviceType = '',
    this.shiftSystem = '',
    this.shiftDescription = '',
    this.workDays = 0,
    this.restDays = 0,
    this.cycleStart = '',
    this.cycleAnchor = '',
    this.cycleDay = 0,
    this.statusLabel = '',
    this.departureTime = '',
    this.housingLocation = '',
    this.jobTitle = '',
    this.gender = '',
    this.transportClass = '',
  });

  final int id;
  final String employeeCode;
  final String name;
  final String company;
  final String department;
  final String phone;
  final String personType;
  final bool active;
  final String notes;
  final String serviceType;
  final String shiftSystem;
  final String shiftDescription;
  final int workDays;
  final int restDays;
  final String cycleStart;
  final String cycleAnchor;
  final int cycleDay;
  final String statusLabel;
  final String departureTime;
  final String housingLocation;
  final String jobTitle;
  final String gender;
  final String transportClass;

  bool get isGeneral => personType == 'general';

  /// نوع الخدمة السكني المعتمد في النظام.
  bool get isHousingService =>
      serviceType == 'سكن' || serviceType == 'نقل-سكن';

  int get cycleLength => workDays + restDays;

  static Employee fromJson(Map<String, dynamic> json) => Employee(
        id: _toInt(json['id']),
        employeeCode: _toStr(json['employee_code']),
        name: _toStr(json['name']),
        company: _toStr(json['company']),
        department: _toStr(json['department']),
        phone: _toStr(json['phone']),
        personType: _toStr(json['person_type'], fallback: 'company'),
        active: _toBool(json['active'], fallback: true),
        notes: _toStr(json['notes']),
        serviceType: _toStr(json['service_type']),
        shiftSystem: _toStr(json['shift_system']),
        shiftDescription: _toStr(json['shift_description']),
        workDays: _toInt(json['work_days']),
        restDays: _toInt(json['rest_days']),
        cycleStart: _toStr(json['cycle_start']),
        cycleAnchor: _toStr(json['cycle_anchor']),
        cycleDay: _toInt(json['cycle_day']),
        statusLabel: _toStr(json['status_label']),
        departureTime: _toStr(json['departure_time']),
        housingLocation: _toStr(json['housing_location']),
        jobTitle: _toStr(json['job_title']),
        gender: _toStr(json['gender']),
        transportClass: _toStr(json['transport_class']),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'employee_code': employeeCode,
        'name': name,
        'company': company,
        'department': department,
        'phone': phone,
        'person_type': personType,
        'active': active,
        'notes': notes,
        'service_type': serviceType,
        'shift_system': shiftSystem,
        'shift_description': shiftDescription,
        'work_days': workDays,
        'rest_days': restDays,
        'cycle_start': cycleStart,
        'cycle_anchor': cycleAnchor,
        'cycle_day': cycleDay,
        'status_label': statusLabel,
        'departure_time': departureTime,
        'housing_location': housingLocation,
        'job_title': jobTitle,
        'gender': gender,
        'transport_class': transportClass,
      };
}

class ServiceItem {
  ServiceItem({
    required this.id,
    required this.code,
    required this.name,
    this.unit = 'قطعة',
    this.rate = 0,
    this.active = true,
  });

  final int id;
  final String code;
  final String name;
  final String unit;
  final double rate;
  final bool active;

  static ServiceItem fromJson(Map<String, dynamic> json) => ServiceItem(
        id: _toInt(json['id']),
        code: _toStr(json['code']),
        name: _toStr(json['name']),
        unit: _toStr(json['unit'], fallback: 'قطعة'),
        rate: _toDouble(json['rate']),
        active: _toBool(json['active'], fallback: true),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'code': code,
        'name': name,
        'unit': unit,
        'rate': rate,
        'active': active,
      };
}

class OrderItem {
  OrderItem({
    required this.id,
    required this.itemName,
    required this.unit,
    required this.quantity,
    required this.unitPrice,
    required this.lineTotal,
    this.serviceItemId,
  });

  final int id;
  final int? serviceItemId;
  final String itemName;
  final String unit;
  final double quantity;
  final double unitPrice;
  final double lineTotal;

  static OrderItem fromJson(Map<String, dynamic> json) => OrderItem(
        id: _toInt(json['id']),
        serviceItemId: json['service_item_id'] == null
            ? null
            : _toInt(json['service_item_id']),
        itemName: _toStr(json['item_name']),
        unit: _toStr(json['unit']),
        quantity: _toDouble(json['quantity']),
        unitPrice: _toDouble(json['unit_price']),
        lineTotal: _toDouble(json['line_total']),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'service_item_id': serviceItemId,
        'item_name': itemName,
        'unit': unit,
        'quantity': quantity,
        'unit_price': unitPrice,
        'line_total': lineTotal,
      };
}

class LaundryOrder {
  LaundryOrder({
    required this.id,
    required this.employeeId,
    required this.serviceDate,
    required this.status,
    required this.fulfillmentStatus,
    required this.subtotal,
    this.reference = '',
    this.personName = '',
    this.notes = '',
    this.employeeCode = '',
    this.employeeName = '',
    this.company = '',
    this.department = '',
    this.serviceType = '',
    this.shiftSystem = '',
    this.shiftDescription = '',
    this.workDays = 0,
    this.restDays = 0,
    this.cycleStart = '',
    this.cycleAnchor = '',
    this.cycleDay = 0,
    this.statusLabel = '',
    this.departureTime = '',
    this.housingLocation = '',
    this.jobTitle = '',
    this.gender = '',
    this.transportClass = '',
    this.creatorName = '',
    this.confirmerName = '',
    this.delivererName = '',
    this.deliveredAt = '',
    this.confirmedAt = '',
    this.createdAt = '',
    this.rejectionReason = '',
    this.clientUuid = '',
    this.pendingSync = false,
    this.items = const <OrderItem>[],
  });

  final int id;
  final String reference;
  final int employeeId;
  final String employeeCode;
  final String employeeName;
  final String company;
  final String department;
  final String serviceType;
  final String shiftSystem;
  final String shiftDescription;
  final int workDays;
  final int restDays;
  final String cycleStart;
  final String cycleAnchor;
  final int cycleDay;
  final String statusLabel;
  final String departureTime;
  final String housingLocation;
  final String jobTitle;
  final String gender;
  final String transportClass;
  final String personName;
  final String serviceDate;
  final String notes;
  final String status;
  final String fulfillmentStatus;
  final String deliveredAt;
  final String creatorName;
  final String confirmerName;
  final String delivererName;
  final String confirmedAt;
  final String createdAt;
  final String rejectionReason;
  final String clientUuid;
  final double subtotal;

  /// طلب أُنشئ على الجهاز ولم يُرفع إلى الخادم بعد.
  final bool pendingSync;

  final List<OrderItem> items;

  bool get isPending => status == 'pending';
  bool get isApproved => status == 'approved';
  bool get isRejected => status == 'rejected';
  bool get isDelivered => fulfillmentStatus == 'delivered';

  /// الاسم المعروض: اسم الزائر للسجل العام، وإلا اسم الموظف.
  String get displayName =>
      personName.trim().isNotEmpty ? personName.trim() : employeeName;

  String get statusText {
    switch (status) {
      case 'approved':
        return 'معتمد';
      case 'rejected':
        return 'مرفوض';
      default:
        return 'بانتظار التأكيد';
    }
  }

  static LaundryOrder fromJson(Map<String, dynamic> json) => LaundryOrder(
        id: _toInt(json['id']),
        reference: _toStr(json['reference']),
        employeeId: _toInt(json['employee_id']),
        employeeCode: _toStr(json['employee_code']),
        employeeName: _toStr(json['employee_name']),
        company: _toStr(json['company']),
        department: _toStr(json['department']),
        serviceType: _toStr(json['service_type']),
        shiftSystem: _toStr(json['shift_system']),
        shiftDescription: _toStr(json['shift_description']),
        workDays: _toInt(json['work_days']),
        restDays: _toInt(json['rest_days']),
        cycleStart: _toStr(json['cycle_start']),
        cycleAnchor: _toStr(json['cycle_anchor']),
        cycleDay: _toInt(json['cycle_day']),
        statusLabel: _toStr(json['status_label']),
        departureTime: _toStr(json['departure_time']),
        housingLocation: _toStr(json['housing_location']),
        jobTitle: _toStr(json['job_title']),
        gender: _toStr(json['gender']),
        transportClass: _toStr(json['transport_class']),
        personName: _toStr(json['person_name']),
        serviceDate: _toStr(json['service_date']),
        notes: _toStr(json['notes']),
        status: _toStr(json['status'], fallback: 'pending'),
        fulfillmentStatus:
            _toStr(json['fulfillment_status'], fallback: 'received'),
        deliveredAt: _toStr(json['delivered_at']),
        creatorName: _toStr(json['creator_name']),
        confirmerName: _toStr(json['confirmer_name']),
        delivererName: _toStr(json['deliverer_name']),
        confirmedAt: _toStr(json['confirmed_at']),
        createdAt: _toStr(json['created_at']),
        rejectionReason: _toStr(json['rejection_reason']),
        clientUuid: _toStr(json['client_uuid']),
        subtotal: _toDouble(json['subtotal']),
        pendingSync: _toBool(json['pending_sync']),
        items: ((json['items'] as List?) ?? const [])
            .map((e) => OrderItem.fromJson((e as Map).cast<String, dynamic>()))
            .toList(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'reference': reference,
        'employee_id': employeeId,
        'employee_code': employeeCode,
        'employee_name': employeeName,
        'company': company,
        'department': department,
        'service_type': serviceType,
        'shift_system': shiftSystem,
        'shift_description': shiftDescription,
        'work_days': workDays,
        'rest_days': restDays,
        'cycle_start': cycleStart,
        'cycle_anchor': cycleAnchor,
        'cycle_day': cycleDay,
        'status_label': statusLabel,
        'departure_time': departureTime,
        'housing_location': housingLocation,
        'job_title': jobTitle,
        'gender': gender,
        'transport_class': transportClass,
        'person_name': personName,
        'service_date': serviceDate,
        'notes': notes,
        'status': status,
        'fulfillment_status': fulfillmentStatus,
        'delivered_at': deliveredAt,
        'creator_name': creatorName,
        'confirmer_name': confirmerName,
        'deliverer_name': delivererName,
        'confirmed_at': confirmedAt,
        'created_at': createdAt,
        'rejection_reason': rejectionReason,
        'client_uuid': clientUuid,
        'subtotal': subtotal,
        'pending_sync': pendingSync,
        'items': items.map((e) => e.toJson()).toList(),
      };
}

/// سطر طلب جديد (قبل الحفظ) يُرفع إلى الخادم.
class PendingOrderLine {
  PendingOrderLine({
    required this.serviceItemId,
    required this.quantity,
    required this.itemName,
    required this.unit,
    required this.unitPrice,
  });

  final int serviceItemId;
  final double quantity;
  final String itemName;
  final String unit;
  final double unitPrice;

  Map<String, dynamic> toJson() => {
        'service_item_id': serviceItemId,
        'quantity': quantity,
        'item_name': itemName,
        'unit': unit,
        'unit_price': unitPrice,
      };

  static PendingOrderLine fromJson(Map<String, dynamic> json) => PendingOrderLine(
        serviceItemId: _toInt(json['service_item_id']),
        quantity: _toDouble(json['quantity']),
        itemName: _toStr(json['item_name']),
        unit: _toStr(json['unit']),
        unitPrice: _toDouble(json['unit_price']),
      );
}

/// طلب أُنشئ دون اتصال وينتظر المزامنة مع الخادم.
class PendingOrder {
  PendingOrder({
    required this.clientUuid,
    required this.employeeId,
    required this.serviceDate,
    required this.createdAt,
    this.personName = '',
    this.notes = '',
    this.lines = const <PendingOrderLine>[],
  });

  final String clientUuid;
  final int employeeId;
  final String serviceDate;
  final String createdAt;
  final String personName;
  final String notes;
  final List<PendingOrderLine> lines;

  double get subtotal => lines.fold(0, (sum, line) => sum + line.quantity * line.unitPrice);

  Map<String, dynamic> toApiJson() => {
        'client_uuid': clientUuid,
        'employee_id': employeeId,
        'service_date': serviceDate,
        'person_name': personName,
        'notes': notes,
        'created_at': createdAt,
        'items': lines
            .map((line) => {
                  'service_item_id': line.serviceItemId,
                  'quantity': line.quantity,
                })
            .toList(),
      };

  Map<String, dynamic> toJson() => {
        'client_uuid': clientUuid,
        'employee_id': employeeId,
        'service_date': serviceDate,
        'created_at': createdAt,
        'person_name': personName,
        'notes': notes,
        'lines': lines.map((e) => e.toJson()).toList(),
      };

  static PendingOrder fromJson(Map<String, dynamic> json) => PendingOrder(
        clientUuid: _toStr(json['client_uuid']),
        employeeId: _toInt(json['employee_id']),
        serviceDate: _toStr(json['service_date']),
        createdAt: _toStr(json['created_at']),
        personName: _toStr(json['person_name']),
        notes: _toStr(json['notes']),
        lines: ((json['lines'] as List?) ?? const [])
            .map((e) => PendingOrderLine.fromJson((e as Map).cast<String, dynamic>()))
            .toList(),
      );
}

/// صف تجميعي في تقرير المستحقات (لكل موظف أو لكل نوع خدمة).
class ReportSummaryRow {
  ReportSummaryRow({
    required this.label,
    required this.employeeCode,
    required this.serviceType,
    required this.quantities,
    required this.total,
  });

  final String label;
  final String employeeCode;
  final String serviceType;
  final Map<String, double> quantities;
  final double total;

  static ReportSummaryRow fromJson(Map<String, dynamic> json) {
    final quantities = <String, double>{};
    ((json['quantities'] as Map?) ?? const {}).forEach((key, value) {
      quantities[key.toString()] = _toDouble(value);
    });
    return ReportSummaryRow(
      label: _toStr(json['label'] ?? json['employee_name']),
      employeeCode: _toStr(json['employee_code']),
      serviceType: _toStr(json['service_type'], fallback: 'غير محدد'),
      quantities: quantities,
      total: _toDouble(json['total']),
    );
  }
}

/// مؤشرات لوحة المتابعة.
class DashboardMetrics {
  DashboardMetrics({
    this.employees = 0,
    this.pending = 0,
    this.monthApproved = 0,
    this.monthAmount = 0,
    this.monthPendingAmount = 0,
  });

  final int employees;
  final int pending;
  final int monthApproved;
  final double monthAmount;
  final double monthPendingAmount;

  static DashboardMetrics fromJson(Map<String, dynamic> json) {
    final raw = (json['metrics'] as Map?) ?? json;
    final map = raw.cast<String, dynamic>();
    return DashboardMetrics(
      employees: _toInt(map['employees']),
      pending: _toInt(map['pending']),
      monthApproved: _toInt(map['month_approved']),
      monthAmount: _toDouble(map['month_amount']),
      monthPendingAmount: _toDouble(map['month_pending_amount']),
    );
  }
}

int _toInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

double _toDouble(dynamic value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

String _toStr(dynamic value, {String fallback = ''}) {
  if (value == null) return fallback;
  final text = value.toString();
  return text.isEmpty ? fallback : text;
}

bool _toBool(dynamic value, {bool fallback = false}) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) {
    final lower = value.toLowerCase();
    if (lower == 'true' || lower == '1' || lower == 'yes') return true;
    if (lower == 'false' || lower == '0' || lower == 'no') return false;
  }
  return fallback;
}
