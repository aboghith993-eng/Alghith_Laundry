import 'package:flutter/material.dart';

import '../models/laundry_models.dart';
import '../state/store_scope.dart';
import '../utils/format.dart';
import '../widgets/app_widgets.dart';
import 'navigation.dart';
import 'order_form_screen.dart';

/// قائمة طلبات المغسلة — مطابقة لشاشة `transactions.html`.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key, this.initialStatus = 'all'});

  final String initialStatus;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  final TextEditingController _search = TextEditingController();
  String _status = 'all';
  String _from = '';
  String _to = '';

  @override
  void initState() {
    super.initState();
    _status = widget.initialStatus;
    final now = DateTime.now();
    _from = firstDayOfMonth(now);
    _to = formatIsoDate(now);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final orders = store.ordersFor(
      from: _from,
      to: _to,
      status: _status,
      search: _search.text,
    );
    final total = orders.fold<double>(0, (sum, o) => sum + o.subtotal);

    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: store.canCreateOrder
          ? FloatingActionButton.extended(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const OrderFormScreen()),
              ),
              backgroundColor: AppColors.green,
              foregroundColor: AppColors.white,
              icon: const Icon(Icons.add_rounded),
              label: const Text('طلب جديد'),
            )
          : null,
      body: RefreshIndicator(
        color: AppColors.green,
        onRefresh: () => store.syncNow(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 90),
          children: <Widget>[
            PageHeading(
              eyebrow: 'سجل المعاملات',
              title: 'طلبات المغسلة',
              subtitle: 'استلام القطع من الموظف ثم الغسيل والتسليم ثم الاعتماد.',
            ),
            const SizedBox(height: 14),
            AppPanel(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  SearchField(
                    controller: _search,
                    hint: 'ابحث برقم الطلب أو اسم الموظف',
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: <Widget>[
                      for (final entry in const <String, String>{
                        'all': 'الكل',
                        'pending': 'بانتظار التأكيد',
                        'approved': 'معتمد',
                        'rejected': 'مرفوض',
                      }.entries)
                        ChoiceChip(
                          label: Text(entry.value),
                          selected: _status == entry.key,
                          onSelected: (_) => setState(() => _status = entry.key),
                          selectedColor: AppColors.mint,
                          labelStyle: TextStyle(
                            color: _status == entry.key ? AppColors.greenDark : AppColors.ink,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                          showCheckmark: false,
                          side: const BorderSide(color: AppColors.line),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: _DateField(
                          label: 'من تاريخ',
                          value: _from,
                          onPick: (value) => setState(() => _from = value),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _DateField(
                          label: 'إلى تاريخ',
                          value: _to,
                          onPick: (value) => setState(() => _to = value),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: <Widget>[
                      Text(
                        '${orders.length} طلب • الإجمالي ${formatMoney(total)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const Spacer(),
                      TextButton.icon(
                        onPressed: () {
                          final now = DateTime.now();
                          setState(() {
                            _from = firstDayOfPreviousMonth(now);
                            _to = formatIsoDate(now);
                            _status = 'all';
                            _search.clear();
                          });
                        },
                        icon: const Icon(Icons.refresh_rounded, size: 16),
                        label: const Text('إعادة الضبط'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            if (orders.isEmpty)
              AppPanel(
                child: EmptyState(
                  icon: '▤',
                  title: 'لا توجد طلبات مطابقة',
                  message: 'غيّر عوامل التصفية أو سجّل طلباً جديداً.',
                  action: store.canCreateOrder
                      ? FilledButton(
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(builder: (_) => const OrderFormScreen()),
                          ),
                          child: const Text('تسجيل طلب'),
                        )
                      : null,
                ),
              )
            else
              for (final order in orders)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _OrderCard(order: order),
                ),
          ],
        ),
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.order});

  final LaundryOrder order;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      padding: const EdgeInsets.all(14),
      child: InkWell(
        onTap: () => openOrderDetail(context, order.id),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    order.reference.isEmpty ? 'طلب محلي' : order.reference,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.ink),
                  ),
                ),
                StatusPill(status: order.status),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(order.displayName, style: const TextStyle(fontSize: 14, color: AppColors.ink, fontWeight: FontWeight.w600)),
                      Text(
                        '${order.employeeCode} • ${order.company.isEmpty ? 'بدون شركة' : order.company}',
                        style: const TextStyle(fontSize: 12, color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Text(formatMoney(order.subtotal), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.ink)),
                    Text(order.serviceDate, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                Icon(
                  order.isDelivered ? Icons.check_circle_rounded : Icons.pending_outlined,
                  size: 15,
                  color: order.isDelivered ? AppColors.green : AppColors.amber,
                ),
                const SizedBox(width: 4),
                Text(
                  order.isDelivered ? 'تم التسليم' : 'لم يُسلّم',
                  style: TextStyle(fontSize: 12, color: order.isDelivered ? AppColors.green : AppColors.amber),
                ),
                if (order.pendingSync) ...<Widget>[
                  const SizedBox(width: 10),
                  const Icon(Icons.cloud_upload_outlined, size: 15, color: AppColors.blue),
                  const SizedBox(width: 4),
                  const Text('بانتظار المزامنة', style: TextStyle(fontSize: 12, color: AppColors.blue)),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _DateField extends StatelessWidget {
  const _DateField({required this.label, required this.value, required this.onPick});

  final String label;
  final String value;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final parsed = DateTime.tryParse(value);
        final picked = await showDatePicker(
          context: context,
          initialDate: parsed ?? DateTime.now(),
          firstDate: DateTime(2015),
          lastDate: DateTime(2100),
        );
        if (picked != null) onPick(formatIsoDate(picked));
      },
      borderRadius: BorderRadius.circular(AppRadius.control),
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
        child: Text(value, style: const TextStyle(fontSize: 13.5, color: AppColors.ink)),
      ),
    );
  }
}
