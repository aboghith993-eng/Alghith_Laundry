/// أدوات تنسيق الأرقام والتواريخ — مطابقة تماماً لتنسيق تطبيق الويب (Python).
library;

/// تنسيق المبالغ بنفس دالة `money` في `app.py`: منزلتان عشريتان وفاصلة آلاف.
String formatMoney(num? value) {
  var number = (value ?? 0).toDouble();
  var sign = '';
  if (number < 0) {
    sign = '-';
    number = -number;
  }
  final fixed = number.toStringAsFixed(2);
  final parts = fixed.split('.');
  final digits = parts[0];
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write(',');
    buffer.write(digits[i]);
  }
  return '$sign$buffer.${parts[1]}';
}

/// تنسيق الكميات: يحذف الأصفار الزائدة (مثل Python format بدون تحديد).
String formatQuantity(num? value) {
  final number = (value ?? 0).toDouble();
  if (number == number.roundToDouble()) return number.toStringAsFixed(0);
  return number.toStringAsFixed(2).replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}

/// تاريخ النظام بصيغة ISO (yyyy-MM-dd) كما يعرضه الويب.
String formatIsoDate(DateTime date) {
  final y = date.year.toString().padLeft(4, '0');
  final m = date.month.toString().padLeft(2, '0');
  final d = date.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

/// تاريخ النظام بصيغة ISO مع الوقت.
String formatIsoDateTime(DateTime date) {
  final h = date.hour.toString().padLeft(2, '0');
  final min = date.minute.toString().padLeft(2, '0');
  final s = date.second.toString().padLeft(2, '0');
  return '${formatIsoDate(date)} $h:$min:$s';
}

/// أسماء الشهور بالعربية.
const List<String> arabicMonths = <String>[
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/// تحويل تاريخ ISO القادم من الخادم إلى نص عربي مقروء.
String formatArabicDate(String? isoDate) {
  if (isoDate == null || isoDate.trim().isEmpty) return '—';
  final raw = isoDate.trim();
  final datePart = raw.split(' ').first;
  final parts = datePart.split('-');
  if (parts.length != 3) return raw;
  final year = int.tryParse(parts[0]) ?? 0;
  final month = int.tryParse(parts[1]) ?? 0;
  final day = int.tryParse(parts[2]) ?? 0;
  if (year == 0 || month < 1 || month > 12) return raw;
  return '$day ${arabicMonths[month - 1]} $year';
}

/// أول يوم من الشهر الحالي (yyyy-MM-dd).
String firstDayOfMonth(DateTime date) => formatIsoDate(DateTime(date.year, date.month, 1));

/// اليوم الأول من الشهر السابق.
String firstDayOfPreviousMonth(DateTime date) {
  final prev = DateTime(date.year, date.month - 1, 1);
  return formatIsoDate(prev);
}

/// توليد معرّف فريد للطلبات المُنشأة دون اتصال (idempotency key).
String generateClientUuid() {
  final random = DateTime.now().microsecondsSinceEpoch;
  final salt = random.toRadixString(36);
  final extra = DateTime.now().hashCode.toRadixString(36);
  return 'lm-$salt-$extra';
}
