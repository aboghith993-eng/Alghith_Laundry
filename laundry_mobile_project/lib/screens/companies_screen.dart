import 'package:flutter/material.dart';

import '../models/laundry_models.dart';
import '../state/store_scope.dart';
import '../widgets/app_widgets.dart';

/// إدارة الشركات — للمدير العام فقط (مكافئ شاشة `companies.html`).
class CompaniesScreen extends StatefulWidget {
  const CompaniesScreen({super.key});

  @override
  State<CompaniesScreen> createState() => _CompaniesScreenState();
}

class _CompaniesScreenState extends State<CompaniesScreen> {
  bool _loading = true;
  int? _busyCompany;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final store = StoreScope.of(context);
    final error = await store.refreshCompanies();
    if (!mounted) return;
    setState(() => _loading = false);
    if (error != null) _snack(error);
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _toggle(Company company) async {
    final store = StoreScope.of(context);
    setState(() => _busyCompany = company.id);
    final error = await store.toggleCompany(company.id);
    if (!mounted) return;
    setState(() => _busyCompany = null);
    if (error != null) {
      _snack(error);
    } else {
      _snack(company.active ? 'تم تعطيل الشركة «${company.name}».' : 'تم تفعيل الشركة «${company.name}».');
    }
  }

  Future<void> _openCreateDialog() async {
    final store = StoreScope.of(context);
    final codeController = TextEditingController();
    final nameController = TextEditingController();
    final usernameController = TextEditingController();
    final passwordController = TextEditingController();
    final adminNameController = TextEditingController();
    String? formError;
    bool submitting = false;

    final created = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            Future<void> submit() async {
              final code = codeController.text.trim();
              final name = nameController.text.trim();
              final username = usernameController.text.trim();
              final password = passwordController.text;
              if (code.isEmpty || name.isEmpty) {
                setDialogState(() => formError = 'رمز الشركة واسمها مطلوبان.');
                return;
              }
              if (username.isNotEmpty && password.length < 8) {
                setDialogState(() => formError = 'كلمة مرور مدير الشركة يجب ألا تقل عن 8 أحرف.');
                return;
              }
              setDialogState(() {
                formError = null;
                submitting = true;
              });
              final error = await store.createCompany(
                code: code,
                name: name,
                adminUsername: username,
                adminPassword: password,
                adminName: adminNameController.text.trim(),
              );
              if (!mounted) return;
              if (error != null) {
                setDialogState(() {
                  formError = error;
                  submitting = false;
                });
                return;
              }
              if (dialogContext.mounted) Navigator.of(dialogContext).pop(true);
            }

            return AlertDialog(
              title: const Text('إضافة شركة جديدة'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    TextField(
                      controller: codeController,
                      textCapitalization: TextCapitalization.characters,
                      decoration: const InputDecoration(labelText: 'رمز الشركة (مثال: SUGAR)'),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: nameController,
                      decoration: const InputDecoration(labelText: 'اسم الشركة'),
                    ),
                    const Divider(height: 24),
                    const Text(
                      'مدير الشركة (اختياري لكن مُستحسن)',
                      style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: AppColors.muted),
                    ),
                    TextField(
                      controller: adminNameController,
                      decoration: const InputDecoration(labelText: 'اسم المدير الكامل'),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: usernameController,
                      decoration: const InputDecoration(labelText: 'اسم المستخدم'),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: passwordController,
                      obscureText: true,
                      decoration: const InputDecoration(labelText: 'كلمة المرور (8 أحرف على الأقل)'),
                    ),
                    if (formError != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Text(formError!, style: const TextStyle(color: AppColors.red, fontSize: 12.5)),
                      ),
                  ],
                ),
              ),
              actions: <Widget>[
                TextButton(
                  onPressed: submitting ? null : () => Navigator.of(dialogContext).pop(false),
                  child: const Text('إلغاء'),
                ),
                FilledButton(
                  onPressed: submitting ? null : submit,
                  child: submitting
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('إنشاء'),
                ),
              ],
            );
          },
        );
      },
    );
    codeController.dispose();
    nameController.dispose();
    usernameController.dispose();
    passwordController.dispose();
    adminNameController.dispose();
    if (created == true) _snack('تم إنشاء الشركة بنجاح.');
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: Column(
        children: <Widget>[
          AppHeader(
            title: 'إدارة الشركات',
            userName: store.currentUser?.fullName ?? '',
            roleLabel: store.currentUser?.roleLabel ?? 'المدير العام',
            onRefresh: _load,
            refreshing: _loading,
            actions: <Widget>[
              IconButton(
                tooltip: 'إضافة شركة',
                onPressed: _openCreateDialog,
                icon: const Icon(Icons.add_business_rounded, color: AppColors.greenDark),
              ),
              IconButton(
                tooltip: 'خروج',
                onPressed: () => store.logout(),
                icon: const Icon(Icons.logout_rounded, color: AppColors.muted),
              ),
            ],
          ),
          Expanded(
            child: RefreshIndicator(
              color: AppColors.green,
              onRefresh: _load,
              child: _loading && store.companies.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                      children: <Widget>[
                        const PageHeading(
                          eyebrow: 'المدير العام',
                          title: 'الشركات المشتركة في النظام',
                          subtitle: 'كل شركة لها مستخدموها وموظفوها وطلباتها وأسعارها المستقلة.',
                        ),
                        const SizedBox(height: 14),
                        if (store.companies.isEmpty)
                          const AppPanel(
                            child: EmptyState(
                              icon: '▦',
                              title: 'لا توجد شركات بعد',
                              message: 'أضف أول شركة ثم أنشئ مديرها من زر الإضافة أعلى الشاشة.',
                            ),
                          )
                        else
                          for (final company in store.companies) ...<Widget>[
                            AppPanel(
                              padding: const EdgeInsets.all(14),
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
                                              company.name,
                                              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink),
                                            ),
                                            const SizedBox(height: 2),
                                            Text(
                                              'الرمز: ${company.code}',
                                              style: const TextStyle(fontSize: 12, color: AppColors.muted),
                                            ),
                                          ],
                                        ),
                                      ),
                                      if (_busyCompany == company.id)
                                        const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                      else
                                        Switch(
                                          value: company.active,
                                          onChanged: (_) => _toggle(company),
                                          activeColor: AppColors.green,
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 10),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: <Widget>[
                                      _CountChip(label: 'موظف', value: company.employees),
                                      _CountChip(label: 'مستخدم', value: company.users),
                                      _CountChip(label: 'طلب', value: company.orders),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: company.active ? AppColors.mint : AppColors.softAmber,
                                          borderRadius: BorderRadius.circular(999),
                                        ),
                                        child: Text(
                                          company.active ? 'مفعّلة' : 'معطّلة',
                                          style: TextStyle(
                                            fontSize: 11.5,
                                            fontWeight: FontWeight.w700,
                                            color: company.active ? AppColors.greenDark : AppColors.amber,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 10),
                          ],
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip({required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.softGreen,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$label: $value',
        style: const TextStyle(fontSize: 11.5, color: AppColors.greenDark, fontWeight: FontWeight.w600),
      ),
    );
  }
}
