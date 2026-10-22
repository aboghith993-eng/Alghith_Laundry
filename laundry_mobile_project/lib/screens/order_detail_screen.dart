import 'package:flutter/material.dart';

import '../state/store_scope.dart';
import '../utils/format.dart';
import '../widgets/app_widgets.dart';

/// تفاصيل طلب المغسلة — مطابقة لشاشة `transaction_detail.html`.
class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.orderId});

  final int orderId;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  bool _busy = false;

  Future<void> _deliver() async {
    final store = StoreScope.read(context);
    setState(() => _busy = true);
    final message = await store.deliverOrder(widget.orderId);
    if (!mounted) return;
    setState(() => _busy = false);
    if (message == null) {
      showSuccess(context, 'تم تسجيل تسليم القطع النظيفة.');
    } else {
      showError(context, message);
    }
  }
  Future<void> _confirm() async {
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (_) => const _DecisionDialog(),
    );
    if (result == null) return;
    if (!mounted) return;
    final store = StoreScope.read(context);
    setState(() => _busy = true);
    final message = await store.confirmOrder(
      widget.orderId,
      result['decision'] ?? 'approved',
      reason: result['reason'] ?? '',
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (message == null) {
      showSuccess(context, result['decision'] == 'approved' ? 'تم اعتماد الطلب.' : 'تم رفض الطلب.');
    } else {
      showError(context, message);
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('حذف الطلب'),
        content: const Text('سيُحذف الطلب غير المعتمد نهائياً. هل تريد المتابعة؟'),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('إلغاء')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.red),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('حذف'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!mounted) return;
    final store = StoreScope.read(context);
    setState(() => _busy = true);
    final message = await store.deleteOrder(widget.orderId);
    if (!mounted) return;
    setState(() => _busy = false);
    if (message == null) {
      showSuccess(context, 'تم حذف الطلب.');
      Navigator.of(context).pop();
    } else {
      showError(context, message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final order = store.orderById(widget.orderId);

    if (order == null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        appBar: AppBar(title: const Text('تفاصيل الطلب')),
        body: const Center(child: Text('الطلب غير موجود')),
      );
    }

    final canDeliver = store.canCreateOrder && order.isPending && !order.isDelivered;
    final canApprove = store.canApprove && order.isPending;
    final canDelete = store.canManageSystem && order.isPending;

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: Text(order.reference.isEmpty ? 'طلب محلي' : order.reference),
        actions: <Widget>[
          if (canDelete)
            IconButton(
              tooltip: 'حذف',
              onPressed: _busy ? null : _delete,
              icon: const Icon(Icons.delete_outline_rounded, color: AppColors.red),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: <Widget>[
          AppPanel(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(order.displayName, style: Theme.of(context).textTheme.titleLarge),
                    ),
                    StatusPill(status: order.status),
                  ],
                ),
                const SizedBox(height: 10),
                DetailRow(label: 'رقم الطلب', value: order.reference.isEmpty ? '—' : order.reference),
                DetailRow(label: 'رقم الموظف', value: order.employeeCode),
                DetailRow(label: 'الشركة', value: order.company.isEmpty ? '—' : order.company),
                DetailRow(label: 'القسم', value: order.department.isEmpty ? '—' : order.department),
                if (order.personName.isNotEmpty)
                  DetailRow(label: 'اسم الزائر', value: order.personName),
                DetailRow(label: 'تاريخ الخدمة', value: order.serviceDate),
                DetailRow(
                  label: 'حالة التسليم',
                  value: order.isDelivered ? 'تم التسليم' : 'لم يُسلّم',
                  valueWidget: Text(
                    order.isDelivered ? 'تم التسليم' : 'لم يُسلّم',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: order.isDelivered ? AppColors.green : AppColors.amber,
                    ),
                  ),
                ),
                DetailRow(label: 'أنشئ بواسطة', value: order.creatorName.isEmpty ? '—' : order.creatorName),
                if (order.delivererName.isNotEmpty)
                  DetailRow(label: 'سجّل التسليم', value: order.delivererName),
                if (order.confirmerName.isNotEmpty)
                  DetailRow(label: 'راجع الطلب', value: order.confirmerName),
                if (order.notes.isNotEmpty) DetailRow(label: 'ملاحظات', value: order.notes),
                if (order.rejectionReason.isNotEmpty)
                  DetailRow(label: 'سبب الرفض', value: order.rejectionReason),
              ],
            ),
          ),
          const SizedBox(height: 14),
          AppPanel(
            title: 'الأصناف المسجلة',
            subtitle: 'الأسعار كما سُجلت وقت إنشاء الطلب',
            padding: EdgeInsets.zero,
            child: order.items.isEmpty
                ? const EmptyState(icon: '◇', title: 'لا توجد أصناف مسجلة')
                : Column(
                    children: <Widget>[
                      for (final item in order.items)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                          child: Row(
                            children: <Widget>[
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: <Widget>[
                                    Text(item.itemName, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.ink)),
                                    Text(
                                      '${formatQuantity(item.quantity)} ${item.unit} × ${formatMoney(item.unitPrice)}',
                                      style: const TextStyle(fontSize: 12, color: AppColors.muted),
                                    ),
                                  ],
                                ),
                              ),
                              Text(
                                formatMoney(item.lineTotal),
                                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.greenDark),
                              ),
                            ],
                          ),
                        ),
                      const Divider(height: 1, color: AppColors.line),
                      Padding(
                        padding: const EdgeInsets.all(14),
                        child: Row(
                          children: <Widget>[
                            const Expanded(
                              child: Text('الإجمالي', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.ink)),
                            ),
                            Text(
                              '${formatMoney(order.subtotal)} ${store.currency}',
                              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.greenDark),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
          ),
          if (order.isPending)
            const Padding(
              padding: EdgeInsets.only(top: 14),
              child: NoticeCard(
                title: 'مسار الاعتماد',
                message: 'لا تدخل هذه القيمة في المستحقات إلا بعد تسجيل تسليم القطع النظيفة ثم اعتماد الطلب من مشرف السكن.',
              ),
            ),
        ],
      ),
      bottomNavigationBar: (canDeliver || canApprove)
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  children: <Widget>[
                    if (canApprove)
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _busy ? null : _confirm,
                          icon: const Icon(Icons.check_rounded, size: 18),
                          label: const Text('اعتماد'),
                        ),
                      ),
                    if (canApprove && canDeliver) const SizedBox(width: 10),
                    if (canDeliver)
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: _busy ? null : _deliver,
                          icon: _busy
                              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.white))
                              : const Icon(Icons.local_shipping_outlined, size: 18),
                          label: const Text('تسجيل التسليم'),
                        ),
                      ),
                  ],
                ),
              ),
            )
          : null,
    );
  }
}

/// حوار الاعتماد أو الرفض.
class _DecisionDialog extends StatefulWidget {
  const _DecisionDialog();

  @override
  State<_DecisionDialog> createState() => _DecisionDialogState();
}

class _DecisionDialogState extends State<_DecisionDialog> {
  final TextEditingController _reason = TextEditingController();
  String _choice = 'approve';

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('مراجعة الطلب'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          RadioListTile<String>(
            value: 'approve',
            groupValue: _choice,
            onChanged: (value) => setState(() => _choice = value ?? 'approve'),
            title: const Text('اعتماد المستحقات'),
            contentPadding: EdgeInsets.zero,
          ),
          RadioListTile<String>(
            value: 'reject',
            groupValue: _choice,
            onChanged: (value) => setState(() => _choice = value ?? 'reject'),
            title: const Text('رفض الطلب'),
            contentPadding: EdgeInsets.zero,
          ),
          if (_choice == 'reject')
            TextField(
              controller: _reason,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'سبب الرفض *'),
            ),
        ],
      ),
      actions: <Widget>[
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('إلغاء')),
        FilledButton(
          onPressed: () {
            if (_choice == 'reject' && _reason.text.trim().isEmpty) {
              showError(context, 'اكتب سبب الرفض لتوضيح المطلوب تعديله.');
              return;
            }
            Navigator.of(context).pop(<String, String>{
              'decision': _choice == 'reject' ? 'rejected' : 'approved',
              'reason': _reason.text.trim(),
            });
          },
          child: const Text('تنفيذ'),
        ),
      ],
    );
  }
}
