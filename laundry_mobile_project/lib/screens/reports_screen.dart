import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../models/laundry_models.dart';
import '../services/laundry_api.dart';
import '../state/store_scope.dart';
import '../utils/format.dart';
import '../widgets/app_widgets.dart';
import 'housing_report_screen.dart';
import 'navigation.dart';

/// التقارير والمستحقات — مطابقة لشاشة `reports.html`.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  String _from = '';
  String _to = '';
  String _status = 'all';
  String _fulfillment = 'all';
  String? _exporting;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _from = firstDayOfMonth(now);
    _to = formatIsoDate(now);
  }

  List<LaundryOrder> _filtered(List<LaundryOrder> orders) => orders.where((order) {
        if (_from.isNotEmpty && order.serviceDate.compareTo(_from) < 0) return false;
        if (_to.isNotEmpty && order.serviceDate.compareTo(_to) > 0) return false;
        if (_status != 'all' && order.status != _status) return false;
        if (_fulfillment == 'received' && order.isDelivered) return false;
        if (_fulfillment == 'delivered' && !order.isDelivered) return false;
        if (_fulfillment == 'partial' && !order.isPartiallyReceived) return false;
        return true;
      }).toList();

  Future<void> _export(String format) async {
    final store = StoreScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _exporting = format);
    try {
      final bytes = await store.exportReport(
        format: format,
        from: _from,
        to: _to,
        status: _status,
        fulfillment: _fulfillment,
      );
      final directory = await getTemporaryDirectory();
      final stamp = '${_from.isEmpty ? 'all' : _from}-${_to.isEmpty ? 'all' : _to}';
      final file = File('${directory.path}/laundry-report-$stamp.$format');
      await file.writeAsBytes(bytes, flush: true);
      final mimeType = switch (format) {
        'pdf' => 'application/pdf',
        'csv' => 'text/csv',
        _ => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      await Share.shareXFiles(
        <XFile>[
          XFile(file.path, mimeType: mimeType),
        ],
        subject: 'تقرير المغسلة ${store.companyName}',
        text: 'تقرير خدمات المغسلة من $_from إلى $_to',
      );
    } on ApiException catch (error) {
      messenger.showSnackBar(SnackBar(content: Text(error.message)));
    } catch (error) {
      messenger.showSnackBar(SnackBar(content: Text('تعذّر تصدير التقرير: $error')));
    } finally {
      if (mounted) setState(() => _exporting = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final orders = _filtered(store.orders);
    final approved = orders.where((o) => o.isApproved).fold<double>(0, (s, o) => s + o.subtotal);
    final pending = orders.where((o) => o.isPending).fold<double>(0, (s, o) => s + o.subtotal);
    final rejected = orders.where((o) => o.isRejected).fold<double>(0, (s, o) => s + o.subtotal);

    // تجميع الكميات لكل موظف (نفس منطق `employee_item_summary`).
    final columns = <String>{};
    final perEmployee = <String, Map<String, double>>{};
    for (final order in orders) {
      final key = order.employeeCode.isEmpty ? order.displayName : order.employeeCode;
      final bucket = perEmployee.putIfAbsent(key, () => <String, double>{});
      for (final item in order.items) {
        bucket[item.itemName] = (bucket[item.itemName] ?? 0) + item.effectiveQuantity;
        columns.add(item.itemName);
      }
    }
    final sortedColumns = columns.toList()..sort();

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: RefreshIndicator(
        color: AppColors.green,
        onRefresh: () => store.syncNow(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: <Widget>[
            const PageHeading(
              eyebrow: 'المستحقات',
              title: 'التقارير والمستحقات',
              subtitle: 'حدد الفترة ثم راجع المستحقات المعتمدة لكل موظف.',
            ),
            const SizedBox(height: 14),
            if (store.currentUser?.role != 'contractor')
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const HousingReportScreen()),
                ),
                icon: const Icon(Icons.home_work_rounded, size: 18),
                label: const Text('تقرير غسيل سكن الموظفين ونسب التغطية'),
              ),
            const SizedBox(height: 12),
            AppPanel(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
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
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: <Widget>[
                      for (final entry in const <String, String>{
                        'all': 'كل الحالات',
                        'approved': 'معتمد',
                        'pending': 'بانتظار التأكيد',
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
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: <Widget>[
                      for (final entry in const <String, String>{
                        'all': 'كل حالات التسليم',
                        'received': 'لم يُسلَّم',
                        'delivered': 'تم التسليم',
                        'partial': 'مستلم جزئياً',
                      }.entries)
                        ChoiceChip(
                          label: Text(entry.value),
                          selected: _fulfillment == entry.key,
                          onSelected: (_) => setState(() => _fulfillment = entry.key),
                          selectedColor: AppColors.softAmber,
                          labelStyle: TextStyle(
                            color: _fulfillment == entry.key ? AppColors.amber : AppColors.ink,
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                          ),
                          showCheckmark: false,
                          side: const BorderSide(color: AppColors.line),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: <Widget>[
                      Text('${orders.length} طلب', style: Theme.of(context).textTheme.bodySmall),
                      const Spacer(),
                      TextButton.icon(
                        onPressed: () {
                          final now = DateTime.now();
                          setState(() {
                            _from = firstDayOfPreviousMonth(now);
                            _to = formatIsoDate(now);
                            _status = 'all';
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
            const SizedBox(height: 12),
            AppPanel(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text(
                    'تصدير التقرير بالفلاتر الحالية ومشاركته',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.ink),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: _exporting == null ? () => _export('pdf') : null,
                          icon: _exporting == 'pdf'
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : const Icon(Icons.picture_as_pdf_rounded, size: 18),
                          label: const Text('PDF'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _exporting == null ? () => _export('xlsx') : null,
                          icon: _exporting == 'xlsx'
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.table_view_rounded, size: 18),
                          label: const Text('Excel'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _exporting == null ? () => _export('csv') : null,
                          icon: _exporting == 'csv'
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.description_outlined, size: 18),
                          label: const Text('CSV'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'يُنتج الخادم الملف بنفس بيانات وتفاصيل التقرير، ثم يفتح نافذة الحفظ أو المشاركة.',
                    style: TextStyle(fontSize: 11.5, color: AppColors.muted),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: 1.05,
              children: <Widget>[
                MetricCard(
                  icon: '✓',
                  label: 'المستحق المعتمد',
                  value: formatMoney(approved),
                  hint: store.currency,
                  color: AppColors.green,
                ),
                MetricCard(
                  icon: '◷',
                  label: 'قيد المراجعة',
                  value: formatMoney(pending),
                  hint: store.currency,
                  color: AppColors.amber,
                ),
                MetricCard(
                  icon: '✕',
                  label: 'طلبات مرفوضة',
                  value: formatMoney(rejected),
                  hint: store.currency,
                  color: AppColors.red,
                ),
                MetricCard(
                  icon: '▤',
                  label: 'إجمالي الطلبات',
                  value: '${orders.length}',
                  hint: 'خلال الفترة',
                  color: AppColors.blue,
                ),
              ],
            ),
            const SizedBox(height: 14),
            AppPanel(
              title: 'ملخص الكميات لكل موظف',
              subtitle: 'كميات الأصناف المستلمة خلال الفترة',
              padding: EdgeInsets.zero,
              child: perEmployee.isEmpty
                  ? const EmptyState(icon: '▥', title: 'لا توجد بيانات في هذه الفترة')
                  : Column(
                      children: <Widget>[
                        for (final entry in perEmployee.entries)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(entry.key, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.ink)),
                                const SizedBox(height: 6),
                                Wrap(
                                  spacing: 6,
                                  runSpacing: 6,
                                  children: <Widget>[
                                    for (final column in sortedColumns)
                                      if ((entry.value[column] ?? 0) > 0)
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                          decoration: BoxDecoration(
                                            color: AppColors.mint,
                                            borderRadius: BorderRadius.circular(999),
                                          ),
                                          child: Text(
                                            '$column: ${formatQuantity(entry.value[column])}',
                                            style: const TextStyle(fontSize: 11.5, color: AppColors.greenDark),
                                          ),
                                        ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
            ),
            const SizedBox(height: 14),
            AppPanel(
              title: 'سجل الطلبات خلال الفترة',
              subtitle: '${orders.length} طلب',
              padding: EdgeInsets.zero,
              child: orders.isEmpty
                  ? const EmptyState(icon: '▤', title: 'لا توجد طلبات في هذه الفترة')
                  : Column(
                      children: <Widget>[
                        for (final order in orders)
                          ListTile(
                            dense: true,
                            title: Text(
                              '${order.reference.isEmpty ? 'طلب محلي' : order.reference} — ${order.displayName}',
                              style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text(
                              '${order.serviceDate} • ${order.items.length} صنف',
                              style: const TextStyle(fontSize: 12, color: AppColors.muted),
                            ),
                            trailing: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: <Widget>[
                                Text(
                                  formatMoney(order.subtotal),
                                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: AppColors.greenDark),
                                ),
                                StatusPill(status: order.status),
                              ],
                            ),
                            onTap: () => openOrderDetail(context, order.id),
                          ),
                      ],
                    ),
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
