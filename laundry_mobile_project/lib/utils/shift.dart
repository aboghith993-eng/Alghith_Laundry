import '../models/laundry_models.dart';

/// أنواع الخدمة السكني المعتمد في النظام (`HOUSING_SERVICE_TYPES` في `app.py`).
const List<String> housingServiceTypes = <String>['سكن', 'نقل-سكن'];

/// حساب موضع الموظف داخل دورة دوامه في تاريخ معيّن.
///
/// نسخة مطابقة لدالة `employee_cycle` في `app.py` اعتماداً على `cycle_anchor`.
class ShiftCycle {
  const ShiftCycle({
    required this.day,
    required this.cycleLength,
    required this.workDays,
    required this.restDays,
    required this.onDuty,
    required this.known,
    required this.label,
  });

  final int day;
  final int cycleLength;
  final int workDays;
  final int restDays;
  final bool onDuty;
  final bool known;
  final String label;
}

ShiftCycle computeShiftCycle(Employee employee, DateTime target) {
  final cycleLength = employee.workDays + employee.restDays;
  if (cycleLength <= 0) {
    return const ShiftCycle(
      day: 0,
      cycleLength: 0,
      workDays: 0,
      restDays: 0,
      onDuty: false,
      known: false,
      label: '',
    );
  }
  final anchor = DateTime.tryParse(employee.cycleAnchor.trim());
  if (anchor == null) {
    return ShiftCycle(
      day: 0,
      cycleLength: cycleLength,
      workDays: employee.workDays,
      restDays: employee.restDays,
      onDuty: false,
      known: false,
      label: '',
    );
  }
  final anchorDate = DateTime(anchor.year, anchor.month, anchor.day);
  final targetDate = DateTime(target.year, target.month, target.day);
  final offset = targetDate.difference(anchorDate).inDays % cycleLength;
  final day = offset + 1;
  final onDuty = day <= employee.workDays;
  return ShiftCycle(
    day: day,
    cycleLength: cycleLength,
    workDays: employee.workDays,
    restDays: employee.restDays,
    onDuty: onDuty,
    known: true,
    label: onDuty ? 'دوام' : 'راحة',
  );
}

/// تنبيهات توافق الموظف مع نوع الخدمة ودورة دوامه في تاريخ الطلب.
///
/// نسخة مطابقة لدالة `employee_shift_warnings` في `app.py`.
List<String> shiftWarnings(Employee employee, DateTime serviceDate) {
  final warnings = <String>[];
  if (employee.serviceType.trim().isNotEmpty &&
      !housingServiceTypes.contains(employee.serviceType.trim())) {
    warnings.add(
      'نوع خدمة الموظف «${employee.serviceType}» وليس «سكن»، فهذه الخدمة تخص السكن فقط.',
    );
  }
  final cycle = computeShiftCycle(employee, serviceDate);
  if (cycle.known && !cycle.onDuty) {
    warnings.add(
      'التاريخ ${serviceDate.year}-${serviceDate.month.toString().padLeft(2, '0')}-${serviceDate.day.toString().padLeft(2, '0')} '
      'يقع في مرحلة الراحة لدورة دوام الموظف '
      '(اليوم ${cycle.day} من ${cycle.cycleLength}، والدوام ${cycle.workDays} يوم عمل).',
    );
  }
  return warnings;
}
