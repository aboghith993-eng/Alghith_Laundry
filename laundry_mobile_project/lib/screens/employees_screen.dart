import 'package:flutter/material.dart';

import '../models/laundry_models.dart';
import '../state/store_scope.dart';
import '../widgets/app_widgets.dart';

/// قاعدة الموظفين — مطابقة لشاشة `employees.html`.
class EmployeesScreen extends StatefulWidget {
  const EmployeesScreen({super.key});

  @override
  State<EmployeesScreen> createState() => _EmployeesScreenState();
}

class _EmployeesScreenState extends State<EmployeesScreen> {
  final TextEditingController _search = TextEditingController();
  String _query = '';
  String _type = 'all';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _openForm({Employee? employee}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(builder: (_) => _EmployeeFormScreen(employee: employee)),
    );
    if (!mounted) return;
    if (saved == true) showSuccess(context, 'تم حفظ بيانات السجل.');
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final query = _query.trim().toLowerCase();
    final list = store.employees.where((employee) {
      if (_type == 'company' && employee.personType != 'company') return false;
      if (_type == 'general' && employee.personType != 'general') return false;
      if (_type == 'active' && !employee.active) return false;
      if (_type == 'inactive' && employee.active) return false;
      if (query.isEmpty) return true;
      return '${employee.employeeCode} ${employee.name} ${employee.company} ${employee.department}'
          .toLowerCase()
          .contains(query);
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: store.canManageEmployees
          ? FloatingActionButton.extended(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.green,
              foregroundColor: AppColors.white,
              icon: const Icon(Icons.person_add_alt_rounded),
              label: const Text('موظف جديد'),
            )
          : null,
      body: RefreshIndicator(
        color: AppColors.green,
        onRefresh: () => store.syncNow(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 90),
          children: <Widget>[
            const PageHeading(
              eyebrow: 'قاعدة البيانات',
              title: 'قاعدة الموظفين',
              subtitle: 'سجلات موظفي الشركة والسجل العام للزوار والضيوف.',
            ),
            const SizedBox(height: 14),
            AppPanel(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  SearchField(
                    controller: _search,
                    hint: 'ابحث بالرقم أو الاسم أو الشركة',
                    onChanged: (value) => setState(() => _query = value),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: <Widget>[
                      for (final entry in const <String, String>{
                        'all': 'الكل',
                        'company': 'شركة',
                        'general': 'سجل عام',
                        'active': 'نشط',
                        'inactive': 'معطّل',
                      }.entries)
                        ChoiceChip(
                          label: Text(entry.value),
                          selected: _type == entry.key,
                          onSelected: (_) => setState(() => _type = entry.key),
                          selectedColor: AppColors.mint,
                          labelStyle: TextStyle(
                            color: _type == entry.key ? AppColors.greenDark : AppColors.ink,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                          showCheckmark: false,
                          side: const BorderSide(color: AppColors.line),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text('${list.length} سجل', style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
            const SizedBox(height: 14),
            if (list.isEmpty)
              const AppPanel(
                child: EmptyState(icon: '♙', title: 'لا توجد سجلات مطابقة'),
              )
            else
              for (final employee in list)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _EmployeeCard(employee: employee),
                ),
          ],
        ),
      ),
    );
  }
}

class _EmployeeCard extends StatelessWidget {
  const _EmployeeCard({required this.employee});

  final Employee employee;

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    return AppPanel(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.softTeal,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Text(
                  employee.name.isEmpty ? '؟' : employee.name.characters.first,
                  style: const TextStyle(color: AppColors.greenDark, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(employee.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: AppColors.ink)),
                    Text(
                      '${employee.employeeCode} • ${employee.company.isEmpty ? 'بدون شركة' : employee.company}',
                      style: const TextStyle(fontSize: 12, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
              if (!employee.active)
                const StatusPill(status: 'rejected', label: 'معطّل')
              else if (employee.isGeneral)
                const StatusPill(status: 'pending', label: 'سجل عام')
              else
                const StatusPill(status: 'approved', label: 'نشط'),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: <Widget>[
              if (employee.serviceType.isNotEmpty) _Tag(employee.serviceType),
              if (employee.department.isNotEmpty) _Tag(employee.department),
              if (employee.jobTitle.isNotEmpty) _Tag(employee.jobTitle),
              if (employee.housingLocation.isNotEmpty) _Tag(employee.housingLocation),
              if (employee.shiftSystem.isNotEmpty) _Tag(employee.shiftSystem),
            ],
          ),
          if (store.canManageEmployees) ...<Widget>[
            const SizedBox(height: 10),
            Row(
              children: <Widget>[
                TextButton.icon(
                  onPressed: () => Navigator.of(context).push<bool>(
                    MaterialPageRoute<bool>(
                      builder: (_) => _EmployeeFormScreen(employee: employee),
                    ),
                  ),
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: const Text('تعديل'),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: () async {
                    final store = StoreScope.read(context);
                    final message = await store.toggleEmployee(employee.id);
                    if (!context.mounted) return;
                    if (message == null) {
                      showSuccess(context, 'تم تحديث حالة السجل.');
                    } else {
                      showError(context, message);
                    }
                  },
                  icon: Icon(
                    employee.active ? Icons.toggle_off_outlined : Icons.toggle_on_outlined,
                    size: 18,
                    color: employee.active ? AppColors.red : AppColors.green,
                  ),
                  label: Text(employee.active ? 'تعطيل' : 'تفعيل'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.line),
      ),
      child: Text(text, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
    );
  }
}

/// نموذج إضافة/تعديل موظف.
class _EmployeeFormScreen extends StatefulWidget {
  const _EmployeeFormScreen({this.employee});

  final Employee? employee;

  @override
  State<_EmployeeFormScreen> createState() => _EmployeeFormScreenState();
}

class _EmployeeFormScreenState extends State<_EmployeeFormScreen> {
  final TextEditingController _code = TextEditingController();
  final TextEditingController _name = TextEditingController();
  final TextEditingController _company = TextEditingController();
  final TextEditingController _department = TextEditingController();
  final TextEditingController _phone = TextEditingController();
  final TextEditingController _notes = TextEditingController();
  String _personType = 'company';
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final employee = widget.employee;
    if (employee != null) {
      _code.text = employee.employeeCode;
      _name.text = employee.name;
      _company.text = employee.company;
      _department.text = employee.department;
      _phone.text = employee.phone;
      _notes.text = employee.notes;
      _personType = employee.personType;
    }
  }

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    _company.dispose();
    _department.dispose();
    _phone.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final store = StoreScope.read(context);
    setState(() => _saving = true);
    final message = await store.saveEmployee(
      id: widget.employee?.id,
      employeeCode: _code.text,
      name: _name.text,
      company: _company.text,
      department: _department.text,
      phone: _phone.text,
      personType: _personType,
      notes: _notes.text,
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (message == null) {
      Navigator.of(context).pop(true);
    } else {
      showError(context, message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.employee != null;
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: Text(editing ? 'تعديل بيانات السجل' : 'إضافة سجل موظف')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: <Widget>[
          AppPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                TextField(
                  controller: _code,
                  decoration: const InputDecoration(labelText: 'رقم الموظف *'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _name,
                  decoration: const InputDecoration(labelText: 'الاسم *'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _company,
                  decoration: const InputDecoration(labelText: 'الشركة'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _department,
                  decoration: const InputDecoration(labelText: 'القسم'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'الهاتف'),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: _personType,
                  decoration: const InputDecoration(labelText: 'نوع السجل'),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem<String>(value: 'company', child: Text('موظف شركة')),
                    DropdownMenuItem<String>(value: 'general', child: Text('سجل عام (زائر)')),
                  ],
                  onChanged: (value) => setState(() => _personType = value ?? 'company'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _notes,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: 'ملاحظات'),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(editing ? 'حفظ التعديلات' : 'إضافة السجل'),
          ),
        ),
      ),
    );
  }
}
