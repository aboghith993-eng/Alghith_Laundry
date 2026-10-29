import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../models/laundry_models.dart';
import '../services/laundry_api.dart';
import '../state/store_scope.dart';
import '../utils/format.dart';
import '../widgets/app_widgets.dart';

/// تقرير غسيل سكن الموظفين: كل الموظفين خلال فترة، مع نسبة التغطية.
class HousingReportScreen extends StatefulWidget {
  const HousingReportScreen({super.key});

  @override
  State<HousingReportScreen> createState() => _HousingReportScreenState();
}

class _HousingReportScreenState extends State<HousingReportScreen> {
  String _from = '';
  String _to = '';
  bool _housingOnly = false;
  bool _loading = true;
  String? _error;
  String? _exporting;
  HousingReport? _report;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _from = firstDayOfMonth(now);
    _to = formatIsoDate(now);
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final store = StoreScope.of(context);
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final report = await store.fetchHousingReport(
        from: _from,
        to: _to,
        housingOnly: _housingOnly,
      );
      if (!mounted) return;
      setState(() => _report = report);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = 'تعذّر تحميل التقرير: $error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _export(String format) async {
    final store = StoreScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _exporting = format);
    try {
      final bytes = await store.exportHousingReport(
        format: format,
        from: _from,
        to: _to,
        housingOnly: _housingOnly,
      );
      final directory = await getTemporaryDirectory();
      final stamp = '${_from.isEmpty ? 'all' : _from}-${_to.isEmpty ? 'all' : _to}';
      final file = File('${directory.path}/housing-report-$stamp.$format');
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
        subject: 'تقرير سكن الموظفين — ${store.companyName}',
        text: 'تقرير غسيل سكن الموظفين من $_from إلى $_to',
      );
    } on ApiException catch (error) {
      messenger.showSnackBar(SnackBar(content: Text(error.message)));
    } catch (error) {
      messenger.showSnackBar(SnackBar(content: Text('تعذّر تصدير التقرير: $error')));
    } finally {
      if (mounted) setState(() => _exporting = null);
    }
  }

  String _qty(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toStringAsFixed(1);

  @override
  Widget build(BuildContext context) {
    final report = _report;
    final summary = report?.summary ?? const <String, dynamic>{};
    int count(String key) => (summary[key] as num?)?.toInt() ?? 0;
    num percent(String key) => (summary[key] as num?) ?? 0;

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('تقرير سكن الموظفين'),
        actions: <Widget>[
          IconButton(
            tooltip: 'تحديث',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.green,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: <Widget>[
            const PageHeading(
              eyebrow: 'متابعة السكن',
              title: 'تغطية غسيل سكن الموظفين',
              subtitle:
                  'كل الموظفين خلال الفترة المحددة: المتواجد بالسكن حسب نظام دوامه، وكميات ملاية السرير ولباس المخدة والبطانية، ونسبة التغطية.',
            ),
            const SizedBox(height: 14),
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
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    activeColor: AppColors.green,
                    title: const Text('عرض المتواجدين بالسكن فقط', style: TextStyle(fontSize: 13)),
                    value: _housingOnly,
                    onChanged: (value) => setState(() => _housingOnly = value),
                  ),
                  Row(
                    children: <Widget>[
                      if (report != null)
                        Text(
                          '${report.periodDays} يوماً · ${report.rows.length} موظف',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      const Spacer(),
                      TextButton.icon(
                        onPressed: _loading
                            ? null
                            : () {
                                final now = DateTime.now();
                                setState(() {
                                  _from = firstDayOfMonth(now);
                                  _to = formatIsoDate(now);
                                });
                                _load();
                              },
                        icon: const Icon(Icons.restart_alt_rounded, size: 16),
                        label: const Text('الشهر الحالي'),
                      ),
                      const SizedBox(width: 4),
                      FilledButton(
                        onPressed: _loading ? null : _load,
                        child: _loading
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('تحديث'),
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
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  const Text(
                    'تصدير التقرير ومشاركته',
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
                ],
              ),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: 12),
              NoticeCard(title: 'تعذّر تحميل التقرير', message: _error!, icon: '!'),
            ],
            if (report != null) ...<Widget>[
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
                    icon: '♙',
                    label: 'إجمالي الموظفين',
                    value: '${count('employees_total')}',
                    hint: 'بالسكن: ${count('housing_total')}',
                    color: AppColors.green,
                  ),
                  MetricCard(
                    icon: '×',
                    label: 'بدون أي غسيل',
                    value: '${count('no_laundry')}',
                    hint: 'ملاية/مخدة/بطانية',
                    color: AppColors.red,
                  ),
                  MetricCard(
                    icon: '✓',
                    label: 'تغطية مكتملة',
                    value: '${count('complete')}',
                    hint: 'جزئي: ${count('partial')}',
                    color: AppColors.blue,
                  ),
                  MetricCard(
                    icon: '%',
                    label: 'متوسط التغطية',
                    value: '${percent('avg_percentage')}%',
                    hint: '${report.start} → ${report.end}',
                    color: AppColors.amber,
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (report.note.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    report.note,
                    style: const TextStyle(fontSize: 11.5, color: AppColors.muted, height: 1.5),
                  ),
                ),
              for (final row in report.rows) ...<Widget>[
                _HousingRowCard(row: row, qty: _qty),
                const SizedBox(height: 10),
              ],
              if (report.rows.isEmpty)
                const EmptyState(
                  icon: '⌂',
                  title: 'لا توجد بيانات',
                  message: 'لا يوجد موظفون مطابقون للفترة أو الفلتر المحدد.',
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _HousingRowCard extends StatelessWidget {
  const _HousingRowCard({required this.row, required this.qty});

  final HousingReportRow row;
  final String Function(double) qty;

  Color get _statusColor {
    switch (row.coverageStatus) {
      case 'مكتمل':
        return AppColors.green;
      case 'جزئي':
        return AppColors.amber;
      default:
        return AppColors.red;
    }
  }

  @override
  Widget build(BuildContext context) {
    final progress = (row.percentage / 100).clamp(0.0, 1.0);
    return AppPanel(
      padding: const EdgeInsets.all(13),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      row.employeeName,
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: AppColors.ink),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${row.employeeCode} · ${row.department.isEmpty ? 'بدون قسم' : row.department}',
                      style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: _statusColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  row.coverageStatus,
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: _statusColor),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: <Widget>[
              _Tag(
                icon: '⌂',
                label: row.isResident ? 'متواجد بالسكن' : row.housingLabel,
                highlight: row.isResident,
              ),
              if (row.housingLocation.isNotEmpty) _Tag(icon: '📍', label: row.housingLocation),
              _Tag(icon: '◷', label: '${row.shiftLabel} · ${row.cycles} دورة'),
              if (row.statusLabel.isNotEmpty) _Tag(icon: '•', label: row.statusLabel),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 7,
              backgroundColor: AppColors.line,
              color: _statusColor,
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: <Widget>[
              Text(
                '${row.percentage}%',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _statusColor),
              ),
              const Spacer(),
              Text(
                'ملاية ${qty(row.sheets)}/${row.targetSheets} · '
                'مخدة ${qty(row.pillows)}/${row.targetPillows} · '
                'بطانية ${qty(row.blankets)}',
                style: const TextStyle(fontSize: 11.5, color: AppColors.ink),
              ),
            ],
          ),
          if (row.missing.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                'ناقص: ${row.missing.join('، ')}',
                style: const TextStyle(fontSize: 11.5, color: AppColors.red),
              ),
            ),
        ],
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.icon, required this.label, this.highlight = false});

  final String icon;
  final String label;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: highlight ? AppColors.mint : AppColors.bg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.line),
      ),
      child: Text(
        '$icon $label',
        style: TextStyle(
          fontSize: 11,
          color: highlight ? AppColors.greenDark : AppColors.muted,
          fontWeight: highlight ? FontWeight.w700 : FontWeight.w500,
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
      borderRadius: BorderRadius.circular(AppRadius.control),
      onTap: () async {
        final initial = DateTime.tryParse(value) ?? DateTime.now();
        final picked = await showDatePicker(
          context: context,
          initialDate: initial,
          firstDate: DateTime(2020),
          lastDate: DateTime(2100),
        );
        if (picked != null) onPick(formatIsoDate(picked));
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.calendar_month_rounded, size: 18)),
        child: Text(value, style: const TextStyle(fontSize: 13)),
      ),
    );
  }
}
