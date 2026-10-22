import 'package:flutter/widgets.dart';

import 'laundry_store.dart';

/// يتيح للشاشات الداخلية الانتقال بين تبويبات الشل الرئيسي.
class ShellScope extends InheritedWidget {
  const ShellScope({super.key, required this.switchTab, required super.child});

  final void Function(AppTab tab, {String? ordersStatus}) switchTab;

  static ShellScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<ShellScope>();
    assert(scope != null, 'ShellScope غير موجود');
    return scope!;
  }

  @override
  bool updateShouldNotify(ShellScope oldWidget) => false;
}
