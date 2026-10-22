import 'package:flutter/material.dart';

import '../models/laundry_models.dart';
import '../state/store_scope.dart';
import '../utils/format.dart';
import '../utils/shift.dart';
import '../widgets/app_widgets.dart';

/// سطر خدمة في نموذج الطلب.
class _OrderLine {
  _OrderLine() {
    controller = TextEditingController(text: '1');
  }

  int? serviceItemId;
  double quantity = 1;
  late final TextEditingController controller;

  void dispose() => controller.dispose();
}

/// تسجيل طلب مغسلة جديد — مطابق لشاشة `transaction_form.html`.
class OrderFormScreen extends StatefulWidget {
  const OrderFormScreen({super.key});

  @override
  State<OrderFormScreen> createState() => _OrderFormScreenState();
}

class _OrderFormScreenState extends State<OrderFormScreen> {
  final TextEditingController _personName = TextEditingController();
  final TextEditingController _notes = TextEditingController();
  final TextEditingController _quantity = TextEditingController(text: '1');

  Employee? _employee;
  DateTime _serviceDate = DateTime.now();
  final List<_OrderLine> _lines = <_OrderLine>[_OrderLine()];
  bool _saving = false;
  @override
  void dispose() {
    _personName.dispose();
    _notes.dispose();
    _quantity.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  ServiceItem? _serviceFor(int? id) {
    if (id == null) return null;
    final store = StoreScope.read(context);
    for (final item in store.serviceItems) {
      if (item.id == id) return item;
    }
    return null;
  }

  double get _grandTotal {
    var total = 0.0;
    for (final line in _lines) {
      final service = _serviceFor(line.serviceItemId);
      if (service == null) continue;
      total += service.rate * line.quantity;
    }
    return total;
  }

  Future<void> _pickEmployee() async {
    final store = StoreScope.read(context);
    final picked = await showModalBottomSheet<Employee>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.bg,
      builder: (_) => _EmployeePickerSheet(employees: store.employees),
    );
    if (picked == null) return;
    setState(() {
      _employee = picked;
      _personName.clear();
    });
  }

  Future<void> _pickService(int index) async {
    final store = StoreScope.read(context);
    final active = store.serviceItems.where((e) => e.active).toList();
    final picked = await showModalBottomSheet<ServiceItem>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.bg,
      builder: (_) => _ServicePickerSheet(items: active),
    );
    if (picked == null) return;
    setState(() => _lines[index].serviceItemId = picked.id);
  }

  Future<void> _save() async {
    final store = StoreScope.read(context);
    if (_employee == null) {
      showError(context, 'اختر الموظف أو المستفيد أولاً.');
      return;
    }
    final lines = <PendingOrderLine>[];
    for (final line in _lines) {
      final service = _serviceFor(line.serviceItemId);
      if (service == null) continue;
      if (line.quantity <= 0) {
        showError(context, 'الكمية يجب أن تكون أكبر من صفر.');
        return;
      }
      lines.add(PendingOrderLine(
        serviceItemId: service.id,
        quantity: line.quantity,
        itemName: service.name,
        unit: service.unit,
        unitPrice: service.rate,
      ));
    }
    if (lines.isEmpty) {
      showError(context, 'أضف صنفاً واحداً على الأقل للطلب.');
      return;
    }
    setState(() => _saving = true);
    final result = await store.createOrder(
      employeeId: _employee!.id,
      serviceDate: formatIsoDate(_serviceDate),
      lines: lines,
      personName: _personName.text,
      notes: _notes.text,
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (!result.ok) {
      showError(context, result.error ?? 'تعذّر حفظ الطلب.');
      return;
    }
    if (result.message != null) {
      showSuccess(context, result.message!);
    } else if (result.warnings.isNotEmpty) {
      showSuccess(context, 'تم حفظ الطلب مع تنبيهات: ${result.warnings.join(' ')}');
    } else {
      showSuccess(context, 'تم حفظ طلب الاستلام بنجاح.');
    }
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final employee = _employee;
    final warnings = employee == null ? <String>[] : shiftWarnings(employee, _serviceDate);
    final cycle = employee == null ? null : computeShiftCycle(employee, _serviceDate);

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('تسجيل طلب مغسلة'),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: <Widget>[
          const PageHeading(
            eyebrow: 'إدخال معاملة جديدة',
            title: 'تسجيل طلب مغسلة',
            subtitle: 'اختر الموظف وأضف جميع قطع الملابس والمفروشات في طلب واحد.',
          ),
          const SizedBox(height: 16),
          AppPanel(
            title: 'بيانات الموظف أو المستفيد',
            subtitle: 'تأكد من اختيار السجل الصحيح قبل تسجيل الخدمات.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                InkWell(
                  onTap: _pickEmployee,
                  borderRadius: BorderRadius.circular(AppRadius.control),
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'الموظف / المستفيد *',
                      suffixIcon: Icon(Icons.expand_more_rounded, color: AppColors.muted),
                    ),
                    child: Text(
                      employee == null
                          ? 'اختر من قاعدة البيانات'
                          : '${employee.employeeCode} — ${employee.name}${employee.isGeneral ? ' (سجل عام)' : ''}',
                      style: TextStyle(
                        fontSize: 14,
                        color: employee == null ? AppColors.muted : AppColors.ink,
                        fontWeight: employee == null ? FontWeight.w400 : FontWeight.w600,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'لضيوف خارج الشركة اختر «موظف عام» واكتب اسم الشخص.',
                  style: TextStyle(fontSize: 12, color: AppColors.muted),
                ),
                const SizedBox(height: 14),
                InkWell(
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _serviceDate,
                      firstDate: DateTime(2015),
                      lastDate: DateTime(2100),
                    );
                    if (picked != null) setState(() => _serviceDate = picked);
                  },
                  borderRadius: BorderRadius.circular(AppRadius.control),
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'تاريخ تقديم الخدمة *',
                      suffixIcon: Icon(Icons.calendar_today_rounded, size: 18, color: AppColors.muted),
                    ),
                    child: Text(formatIsoDate(_serviceDate), style: const TextStyle(fontSize: 14, color: AppColors.ink)),
                  ),
                ),
                if (employee != null && employee.isGeneral) ...<Widget>[
                  const SizedBox(height: 14),
                  TextField(
                    controller: _personName,
                    decoration: const InputDecoration(labelText: 'اسم الزائر / الضيف *'),
                  ),
                ],
                if (employee != null && cycle != null && cycle.known) ...<Widget>[
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.mint,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.focus.withValues(alpha: .45)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'بيانات السكن والدوام — اليوم ${cycle.day} من ${cycle.cycleLength} (${cycle.label})',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: AppColors.greenDark),
                        ),
                        if (employee.shiftSystem.isNotEmpty)
                          Text(
                            employee.shiftSystem,
                            style: const TextStyle(fontSize: 12.5, color: AppColors.ink, height: 1.6),
                          ),
                        if (employee.statusLabel.isNotEmpty)
                          Text(
                            'الحالة: ${employee.statusLabel}',
                            style: const TextStyle(fontSize: 12.5, color: AppColors.ink),
                          ),
                      ],
                    ),
                  ),
                ],
                if (warnings.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 12),
                  for (final warning in warnings)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: NoticeCard(title: 'تنبيه توافق', message: warning),
                    ),
                ],
                const SizedBox(height: 14),
                TextField(
                  controller: _notes,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'ملاحظات الطلب',
                    hintText: 'رقم الغرفة أو ملاحظة الاستلام (اختياري)',
                  ),
                ),
                const SizedBox(height: 12),
                const InfoNote(
                  title: 'مسار الاعتماد',
                  message: 'يسجّل هذا النموذج استلام القطع من الموظف. بعد الغسيل والكي، يؤكد المتعهد تسليم القطع النظيفة، ثم يراجع مشرف السكن الطلب. لا تدخل المستحقات إلا بعد التسليم والاعتماد.',
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          AppPanel(
            title: 'تفاصيل الخدمات والقطع',
            subtitle: 'أضف سطراً لكل نوع خدمة مع الكمية المستلمة من الموظف.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                for (var i = 0; i < _lines.length; i++) _buildLine(i),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () => setState(() => _lines.add(_OrderLine())),
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('إضافة صنف آخر'),
                ),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.mint,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: <Widget>[
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            const Text('الإجمالي التقديري', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.greenDark)),
                            const SizedBox(height: 2),
                            Text(
                              'السعر النهائي وفق الأسعار الحالية، ويعتمد بعد مراجعة مشرف السكن.',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 10),
                      Text(
                        '${formatMoney(_grandTotal)} ${store.currency}',
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17, color: AppColors.greenDark),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.white))
                : const Icon(Icons.check_rounded, size: 20),
            label: const Text('حفظ طلب الاستلام'),
          ),
        ),
      ),
    );
  }

  Widget _buildLine(int index) {
    final line = _lines[index];
    final service = _serviceFor(line.serviceItemId);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: InkWell(
                  onTap: () => _pickService(index),
                  borderRadius: BorderRadius.circular(AppRadius.control),
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'الخدمة / الصنف',
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    ),
                    child: Text(
                      service?.name ?? 'اختر الخدمة',
                      style: TextStyle(
                        fontSize: 13.5,
                        color: service == null ? AppColors.muted : AppColors.ink,
                        fontWeight: service == null ? FontWeight.w400 : FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ),
              if (_lines.length > 1)
                IconButton(
                  tooltip: 'حذف السطر',
                  onPressed: () => setState(() {
                    final removed = _lines.removeAt(index);
                    removed.dispose();
                  }),
                  icon: const Icon(Icons.close_rounded, size: 20, color: AppColors.red),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: <Widget>[
                Expanded(
                child: TextField(
                  controller: line.controller,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  onChanged: (value) {
                    final parsed = double.tryParse(value.replaceAll(',', ''));
                    setState(() => line.quantity = parsed ?? 0);
                  },
                  decoration: const InputDecoration(
                    labelText: 'الكمية',
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text('سعر الوحدة', style: TextStyle(fontSize: 12, color: AppColors.muted)),
                    Text(
                      service == null ? '—' : '${formatMoney(service.rate)} ${currencyLabel(context)}',
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: AppColors.ink),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text('المجموع', style: TextStyle(fontSize: 12, color: AppColors.muted)),
                    Text(
                      service == null ? '—' : formatMoney(service.rate * line.quantity),
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: AppColors.greenDark),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String currencyLabel(BuildContext context) {
    final store = StoreScope.read(context);
    return store.currency;
  }
}

/// اختيار الموظف من قاعدة البيانات مع بحث فوري.
class _EmployeePickerSheet extends StatefulWidget {
  const _EmployeePickerSheet({required this.employees});

  final List<Employee> employees;

  @override
  State<_EmployeePickerSheet> createState() => _EmployeePickerSheetState();
}

class _EmployeePickerSheetState extends State<_EmployeePickerSheet> {
  final TextEditingController _controller = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _query.trim().toLowerCase();
    final list = widget.employees.where((employee) {
      if (query.isEmpty) return true;
      return '${employee.employeeCode} ${employee.name} ${employee.company} ${employee.department}'
          .toLowerCase()
          .contains(query);
    }).toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: .85,
      builder: (context, controller) => Column(
        children: <Widget>[
          const SizedBox(height: 10),
          Container(
            width: 44,
            height: 4,
            decoration: BoxDecoration(color: AppColors.line, borderRadius: BorderRadius.circular(999)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text('اختر الموظف أو المستفيد', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 10),
                SearchField(
                  controller: _controller,
                  hint: 'ابحث برقم الموظف أو الاسم',
                  onChanged: (value) => setState(() => _query = value),
                ),
              ],
            ),
          ),
          Expanded(
            child: list.isEmpty
                ? const EmptyState(icon: '♙', title: 'لا توجد نتائج مطابقة')
                : ListView.builder(
                    controller: controller,
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    itemCount: list.length,
                    itemBuilder: (context, index) {
                      final employee = list[index];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppPanel(
                          padding: const EdgeInsets.all(12),
                          child: InkWell(
                            onTap: () => Navigator.of(context).pop(employee),
                            child: Row(
                              children: <Widget>[
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: <Widget>[
                                      Text(
                                        '${employee.employeeCode} — ${employee.name}',
                                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.ink),
                                      ),
                                      Text(
                                        '${employee.company.isEmpty ? 'بدون شركة' : employee.company}'
                                        '${employee.department.isEmpty ? '' : ' • ${employee.department}'}',
                                        style: const TextStyle(fontSize: 12, color: AppColors.muted),
                                      ),
                                    ],
                                  ),
                                ),
                                if (employee.isGeneral)
                                  const StatusPill(status: 'pending', label: 'سجل عام'),
                                if (!employee.active)
                                  const Padding(
                                    padding: EdgeInsets.only(right: 6),
                                    child: StatusPill(status: 'rejected', label: 'معطّل'),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

/// اختيار الخدمة من قائمة الأسعار.
class _ServicePickerSheet extends StatefulWidget {
  const _ServicePickerSheet({required this.items});

  final List<ServiceItem> items;

  @override
  State<_ServicePickerSheet> createState() => _ServicePickerSheetState();
}

class _ServicePickerSheetState extends State<_ServicePickerSheet> {
  final TextEditingController _controller = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final query = _query.trim().toLowerCase();
    final list = widget.items.where((item) {
      if (query.isEmpty) return true;
      return '${item.name} ${item.code}'.toLowerCase().contains(query);
    }).toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: .7,
      builder: (context, controller) => Column(
        children: <Widget>[
          const SizedBox(height: 10),
          Container(
            width: 44,
            height: 4,
            decoration: BoxDecoration(color: AppColors.line, borderRadius: BorderRadius.circular(999)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text('اختر الخدمة', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 10),
                SearchField(
                  controller: _controller,
                  hint: 'ابحث باسم الخدمة',
                  onChanged: (value) => setState(() => _query = value),
                ),
              ],
            ),
          ),
          Expanded(
            child: list.isEmpty
                ? const EmptyState(icon: '◇', title: 'لا توجد خدمات متاحة')
                : ListView.builder(
                    controller: controller,
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    itemCount: list.length,
                    itemBuilder: (context, index) {
                      final item = list[index];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppPanel(
                          padding: const EdgeInsets.all(12),
                          child: InkWell(
                            onTap: () => Navigator.of(context).pop(item),
                            child: Row(
                              children: <Widget>[
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: <Widget>[
                                      Text(item.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AppColors.ink)),
                                      Text(item.unit, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                                    ],
                                  ),
                                ),
                                Text(
                                  '${formatMoney(item.rate)} ${store.currency}',
                                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.greenDark),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
