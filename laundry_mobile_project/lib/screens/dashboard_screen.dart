import 'package:flutter/material.dart';

import '../models/laundry_models.dart';
import '../state/laundry_store.dart';
import '../state/shell_scope.dart';
import '../state/store_scope.dart';
import '../utils/format.dart';
import '../widgets/app_widgets.dart';
import 'navigation.dart';
import 'order_form_screen.dart';

/// لوحة المتابعة — مطابقة لشاشة `dashboard.html`.
class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final metrics = store.metrics;
    final latest = store.latestOrders;

    return RefreshIndicator(
      color: AppColors.green,
      onRefresh: () => store.syncNow(),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: <Widget>[
          PageHeading(
            eyebrow: 'ملخص التشغيل',
            title: 'لوحة المتابعة',
            subtitle: 'متابعة أعمال المغسلة وطلبات الموظفين واعتمادات مشرف السكن.',
            action: store.canCreateOrder
                ? FilledButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => const OrderFormScreen()),
                    ),
                    icon: const Icon(Icons.add_rounded, size: 20),
                    label: const Text('تسجيل طلب جديد'),
                  )
                : null,
          ),
          const SizedBox(height: 16),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            childAspectRatio: .92,
            children: <Widget>[
              MetricCard(
                icon: '♙',
                label: 'الموظفون المسجلون',
                value: '${metrics.employees}',
                hint: 'سجلات الشركة النشطة',
                color: AppColors.green,
              ),
              MetricCard(
                icon: '◷',
                label: 'طلبات بانتظار التأكيد',
                value: '${metrics.pending}',
                hint: 'تحتاج مراجعة مشرف السكن',
                color: AppColors.amber,
              ),
              MetricCard(
                icon: '✓',
                label: 'طلبات معتمدة هذا الشهر',
                value: '${metrics.monthApproved}',
                hint: 'من ${DateTime.now().year}-${DateTime.now().month.toString().padLeft(2, '0')}',
                color: AppColors.blue,
              ),
              MetricCard(
                icon: 'ر.ي',
                label: 'المستحق المعتمد هذا الشهر',
                value: formatMoney(metrics.monthAmount),
                hint: store.currency,
                color: AppColors.green,
              ),
            ],
          ),
          const SizedBox(height: 16),
          AppPanel(
            title: 'أحدث طلبات المغسلة',
            subtitle: 'آخر المعاملات التي تم تسجيلها',
            trailing: TextButton(
              onPressed: () {},
              child: const Text('عرض الكل ←'),
            ),
            padding: EdgeInsets.zero,
            child: latest.isEmpty
                ? EmptyState(
                    icon: '▤',
                    title: 'لا توجد طلبات بعد',
                    message: 'ابدأ بتسجيل أول طلب للمغسلة.',
                    action: store.canCreateOrder
                        ? FilledButton(
                            onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(builder: (_) => const OrderFormScreen()),
                            ),
                            child: const Text('تسجيل أول طلب'),
                          )
                        : null,
                  )
                : Column(
                    children: <Widget>[
                      for (final order in latest)
                        _LatestOrderTile(order: order),
                    ],
                  ),
          ),
          const SizedBox(height: 16),
          AppPanel(
            title: 'اختصارات العمل',
            subtitle: 'الوصول السريع للمهام',
            child: Column(
              children: <Widget>[
                if (store.canCreateOrder)
                  _QuickAction(
                    icon: '＋',
                    title: 'تسجيل خدمة جديدة',
                    subtitle: 'غسيل أو كي أو مفروشات',
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => const OrderFormScreen()),
                    ),
                  ),
                if (store.canApprove)
                  _QuickAction(
                    icon: '◷',
                    iconColor: AppColors.amber,
                    title: 'طلبات بحاجة للتأكيد',
                    subtitle: 'مراجعة واعتماد السجلات',
                    onTap: () => ShellScope.of(context).switchTab(AppTab.orders, ordersStatus: 'pending'),
                  ),
                if (store.canManageEmployees)
                  _QuickAction(
                    icon: '♙',
                    iconColor: AppColors.blue,
                    title: 'قاعدة بيانات الموظفين',
                    subtitle: 'إضافة أو تعديل البيانات',
                    onTap: () => ShellScope.of(context).switchTab(AppTab.employees),
                  ),
                _QuickAction(
                  icon: '▥',
                  iconColor: AppColors.green,
                  title: 'تقرير المستحقات',
                  subtitle: 'حدد فترة واعرض الكشف',
                  onTap: () => ShellScope.of(context).switchTab(AppTab.reports),
                ),
                const SizedBox(height: 6),
                const NoticeCard(
                  title: 'تنبيه مهم',
                  message: 'تظهر قيمة الخدمة وفق السعر وقت تسجيل الطلب. لا تدخل الطلبات في المستحقات إلا بعد تأكيد التسليم ثم اعتمادها من مشرف السكن.',
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LatestOrderTile extends StatelessWidget {
  const _LatestOrderTile({required this.order});

  final LaundryOrder order;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => openOrderDetail(context, order.id),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              flex: 5,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    order.reference.isEmpty ? 'طلب محلي' : order.reference,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.ink),
                  ),
                  const SizedBox(height: 2),
                  Text(order.displayName, style: const TextStyle(fontSize: 13.5, color: AppColors.ink)),
                  Text(order.employeeCode, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                ],
              ),
            ),
            Expanded(
              flex: 3,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Text(formatMoney(order.subtotal), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.ink)),
                  const SizedBox(height: 4),
                  StatusPill(status: order.status),
                  const SizedBox(height: 3),
                  Text(
                    order.isDelivered ? 'تم التسليم' : 'لم يُسلّم',
                    style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.chevron_left_rounded, color: AppColors.muted, size: 20),
          ],
        ),
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.iconColor = AppColors.green,
  });

  final String icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: <Widget>[
            Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: iconColor.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(11),
              ),
              child: Text(icon, style: TextStyle(color: iconColor, fontWeight: FontWeight.w700, fontSize: 16)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AppColors.ink)),
                  Text(subtitle, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                ],
              ),
            ),
            const Icon(Icons.arrow_back_rounded, size: 18, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}
