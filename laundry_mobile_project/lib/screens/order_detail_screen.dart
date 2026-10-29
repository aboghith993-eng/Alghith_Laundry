import 'package:flutter/material.dart';

import '../models/laundry_models.dart';
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
    final order = store.orderById(widget.orderId);
    if (order == null) return;
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => _DeliveryDialog(order: order),
    );
    if (result == null || !mounted) return;
    setState(() => _busy = true);
    final message = await store.deliverOrder(
      widget.orderId,
      receiverKind: result['receiver_kind'] as String? ?? 'same_employee',
      receiverName: result['receiver_name'] as String? ?? '',
      pieces: (result['pieces'] as List).cast<Map<String, dynamic>>(),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (message == null) {
      showSuccess(
        context,
        order.isDelivered
            ? 'تم استلام بقية الأصناف من المغسلة.'
            : 'تم تسجيل استلام القطع النظيفة من المغسلة.',
      );
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

    final canDeliver = store.canCreateOrder && !order.isRejected && order.hasRemainingPieces;
    final canApprove = store.canApprove && order.isPending;
    final isContractor = store.currentUser?.role == 'contractor';
    final canDelete = store.canManageSystem || (isContractor && order.isPending);

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
                if (order.receiverName.isNotEmpty)
                  DetailRow(
                    label: order.receiverKind == 'other' ? 'مستلم آخر للأصناف' : 'مستلم الأصناف',
                    value: order.receiverName,
                  ),
                if (order.receivedAt.isNotEmpty)
                  DetailRow(label: 'وقت آخر استلام', value: order.receivedAt),
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
                                    if (item.receivedQuantity != null)
                                      Text(
                                        item.remaining > 0
                                            ? 'مستلم ${formatQuantity(item.received)} · متبقٍ ${formatQuantity(item.remaining)}'
                                            : 'تم استلام ${formatQuantity(item.received)}',
                                        style: TextStyle(
                                          fontSize: 11.5,
                                          fontWeight: FontWeight.w600,
                                          color: item.remaining > 0 ? AppColors.amber : AppColors.green,
                                        ),
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
          if (order.isPartiallyReceived)
            Padding(
              padding: const EdgeInsets.only(top: 14),
              child: NoticeCard(
                title: 'استلام جزئي',
                message:
                    'تم استلام جزء من القطع، وما زال متبقياً ${formatQuantity(order.remainingTotal)} قطعة. يمكنك استلام البقية لاحقاً من نفس الشاشة.',
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
                          label: Text(order.isDelivered ? 'استلام بقية الأصناف' : 'تسجيل التسليم'),
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

/// حوار استلام الأصناف من المغسلة: المستلم + القطع والكميات (يدعم الاستلام الجزئي).
class _DeliveryDialog extends StatefulWidget {
  const _DeliveryDialog({required this.order});

  final LaundryOrder order;

  @override
  State<_DeliveryDialog> createState() => _DeliveryDialogState();
}

class _DeliveryDialogState extends State<_DeliveryDialog> {
  String _receiverKind = 'same_employee';
  final TextEditingController _receiverName = TextEditingController();
  final Map<int, TextEditingController> _quantities = <int, TextEditingController>{};
  final Map<int, bool> _selected = <int, bool>{};
  String? _error;

  List<OrderItem> get _remainingItems =>
      widget.order.items.where((item) => item.remaining > 0).toList();

  @override
  void initState() {
    super.initState();
    for (final item in _remainingItems) {
      _selected[item.id] = true;
      _quantities[item.id] = TextEditingController(text: _plain(item.remaining));
    }
  }

  String _plain(double value) {
    if (value == value.roundToDouble()) return value.toStringAsFixed(0);
    return value.toStringAsFixed(2).replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
  }

  @override
  void dispose() {
    _receiverName.dispose();
    for (final controller in _quantities.values) {
      controller.dispose();
    }
    super.dispose();
  }

  void _submit() {
    final pieces = <Map<String, dynamic>>[];
    for (final item in _remainingItems) {
      if (_selected[item.id] != true) continue;
      final raw = _quantities[item.id]?.text.trim() ?? '';
      final quantity = double.tryParse(raw);
      if (quantity == null || quantity <= 0) {
        setState(() => _error = 'أدخل كمية صحيحة أكبر من صفر للصنف ${item.itemName}.');
        return;
      }
      if (quantity > item.remaining + 1e-9) {
        setState(() => _error =
            'الكمية المستلمة للصنف ${item.itemName} أكبر من المتبقي (${_plain(item.remaining)}).');
        return;
      }
      pieces.add(<String, dynamic>{'id': item.id, 'quantity': quantity});
    }
    if (pieces.isEmpty) {
      setState(() => _error = 'حدّد قطعة واحدة على الأقل تم استلامها.');
      return;
    }
    if (_receiverKind == 'other' && _receiverName.text.trim().isEmpty) {
      setState(() => _error = 'اكتب اسم مستلم الأصناف.');
      return;
    }
    Navigator.of(context).pop(<String, dynamic>{
      'receiver_kind': _receiverKind,
      'receiver_name': _receiverKind == 'other' ? _receiverName.text.trim() : '',
      'pieces': pieces,
    });
  }

  @override
  Widget build(BuildContext context) {
    final remaining = _remainingItems;
    return AlertDialog(
      title: Text(widget.order.isDelivered ? 'استلام بقية الأصناف' : 'استلام الأصناف من المغسلة'),
      content: SizedBox(
        width: double.maxFinite,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text(
                'من الذي استلم الأصناف؟',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.ink),
              ),
              RadioListTile<String>(
                value: 'same_employee',
                groupValue: _receiverKind,
                onChanged: (value) => setState(() => _receiverKind = value ?? 'same_employee'),
                title: const Text('نفس الموظف المسجل في الطلب', style: TextStyle(fontSize: 13)),
                subtitle: Text(widget.order.displayName, style: const TextStyle(fontSize: 11.5)),
                contentPadding: EdgeInsets.zero,
                dense: true,
              ),
              RadioListTile<String>(
                value: 'other',
                groupValue: _receiverKind,
                onChanged: (value) => setState(() => _receiverKind = value ?? 'other'),
                title: const Text('مستلم آخر (يُسجَّل اسمه)', style: TextStyle(fontSize: 13)),
                contentPadding: EdgeInsets.zero,
                dense: true,
              ),
              if (_receiverKind == 'other')
                TextField(
                  controller: _receiverName,
                  decoration: const InputDecoration(labelText: 'اسم المستلم *'),
                ),
              const Divider(height: 22),
              const Text(
                'القطع المستلمة الآن مع العدد',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.ink),
              ),
              const SizedBox(height: 4),
              for (final item in remaining)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      CheckboxListTile(
                        value: _selected[item.id] ?? false,
                        onChanged: (value) => setState(() => _selected[item.id] = value ?? false),
                        title: Text(item.itemName, style: const TextStyle(fontSize: 13)),
                        subtitle: Text(
                          'المتبقي ${_plain(item.remaining)} من ${formatQuantity(item.quantity)} ${item.unit}',
                          style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                        ),
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        controlAffinity: ListTileControlAffinity.leading,
                      ),
                      if (_selected[item.id] == true)
                        TextField(
                          controller: _quantities[item.id],
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: const InputDecoration(
                            labelText: 'الكمية المستلمة',
                            isDense: true,
                          ),
                        ),
                    ],
                  ),
                ),
              if (remaining.isEmpty)
                const Text(
                  'تم استلام جميع القطع مسبقاً.',
                  style: TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    _error!,
                    style: const TextStyle(fontSize: 12, color: AppColors.red, fontWeight: FontWeight.w600),
                  ),
                ),
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('إلغاء')),
        FilledButton(onPressed: _submit, child: const Text('تأكيد الاستلام')),
      ],
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
