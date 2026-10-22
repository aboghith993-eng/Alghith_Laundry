import 'package:flutter/widgets.dart';

import 'laundry_store.dart';

/// يتيح الوصول إلى [LaundryStore] في شجرة الواجهة مع إعادة بناء عند التغيير.
class StoreScope extends InheritedNotifier<LaundryStore> {
  const StoreScope({super.key, required LaundryStore store, required super.child})
      : super(notifier: store);

  static LaundryStore of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<StoreScope>();
    assert(scope != null, 'StoreScope غير موجود في شجرة الواجهة');
    return scope!.notifier!;
  }

  /// قراءة المتجر دون الاشتراك في إعادة البناء (للأحداث فقط).
  static LaundryStore read(BuildContext context) {
    final scope = context.getInheritedWidgetOfExactType<StoreScope>();
    assert(scope != null, 'StoreScope غير موجود في شجرة الواجهة');
    return scope!.notifier!;
  }
}
