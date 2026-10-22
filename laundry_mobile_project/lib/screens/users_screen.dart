import 'package:flutter/material.dart';

import '../models/laundry_models.dart';
import '../state/laundry_store.dart';
import '../state/store_scope.dart';
import '../widgets/app_widgets.dart';

/// المستخدمون والصلاحيات — مطابقة لشاشة `users.html`.
class UsersScreen extends StatelessWidget {
  const UsersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final users = store.users;

    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push<bool>(
          MaterialPageRoute<bool>(builder: (_) => const _UserFormScreen()),
        ),
        backgroundColor: AppColors.green,
        foregroundColor: AppColors.white,
        icon: const Icon(Icons.person_add_alt_rounded),
        label: const Text('حساب جديد'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 90),
        children: <Widget>[
          const PageHeading(
            eyebrow: 'إدارة النظام',
            title: 'المستخدمون والصلاحيات',
            subtitle: 'حسابات الدخول وأدوارها: مدير النظام، متعهد المغسلة، مشرف السكن.',
          ),
          const SizedBox(height: 14),
          if (users.isEmpty)
            const AppPanel(child: EmptyState(icon: '♧', title: 'لا يوجد مستخدمون'))
          else
            for (final user in users)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _UserCard(user: user),
              ),
        ],
      ),
    );
  }
}

class _UserCard extends StatelessWidget {
  const _UserCard({required this.user});

  final AppUser user;

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final isCurrent = store.currentUser?.id == user.id;
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
                  user.fullName.isEmpty ? '؟' : user.fullName.characters.first,
                  style: const TextStyle(color: AppColors.greenDark, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(user.fullName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: AppColors.ink)),
                    Text('@${user.username}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                  ],
                ),
              ),
              StatusPill(
                status: user.active ? 'approved' : 'rejected',
                label: user.active ? 'نشط' : 'معطّل',
              ),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.bg,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppColors.line),
            ),
            child: Text(
              user.roleLabel.isEmpty ? user.role : user.roleLabel,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 4,
            runSpacing: 2,
            alignment: WrapAlignment.end,
            children: <Widget>[
              TextButton.icon(
                onPressed: () => Navigator.of(context).push<bool>(
                  MaterialPageRoute<bool>(builder: (_) => _UserFormScreen(user: user)),
                ),
                icon: const Icon(Icons.edit_outlined, size: 16),
                label: const Text('تعديل'),
              ),
              TextButton.icon(
                onPressed: () => Navigator.of(context).push<bool>(
                  MaterialPageRoute<bool>(builder: (_) => _ResetPasswordScreen(user: user)),
                ),
                icon: const Icon(Icons.key_rounded, size: 16),
                label: const Text('كلمة المرور'),
              ),
              if (!isCurrent)
                TextButton.icon(
                  onPressed: () async {
                    final message = await store.toggleUser(user.id);
                    if (!context.mounted) return;
                    if (message == null) {
                      showSuccess(context, 'تم تحديث حالة الحساب.');
                    } else {
                      showError(context, message);
                    }
                  },
                  icon: Icon(
                    user.active ? Icons.toggle_off_outlined : Icons.toggle_on_outlined,
                    size: 18,
                    color: user.active ? AppColors.red : AppColors.green,
                  ),
                  label: Text(user.active ? 'تعطيل' : 'تفعيل'),
                ),
              if (!isCurrent)
                TextButton.icon(
                  onPressed: () => _confirmDelete(context, store, user),
                  icon: const Icon(Icons.delete_outline_rounded, size: 17, color: AppColors.red),
                  label: const Text('حذف', style: TextStyle(color: AppColors.red)),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, LaundryStore store, AppUser user) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('حذف الحساب'),
        content: Text('هل تريد حذف حساب «${user.fullName}» (@${user.username})؟ لا يمكن التراجع عن هذا الإجراء.'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.red),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('حذف'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final message = await store.deleteUser(user.id);
    if (!context.mounted) return;
    if (message == null) {
      showSuccess(context, 'تم حذف الحساب.');
    } else {
      showError(context, message);
    }
  }
}

class _UserFormScreen extends StatefulWidget {
  const _UserFormScreen({this.user});

  final AppUser? user;

  @override
  State<_UserFormScreen> createState() => _UserFormScreenState();
}

class _UserFormScreenState extends State<_UserFormScreen> {
  final TextEditingController _username = TextEditingController();
  final TextEditingController _fullName = TextEditingController();
  final TextEditingController _password = TextEditingController();
  String _role = 'contractor';
  bool _saving = false;

  bool get _editing => widget.user != null;

  @override
  void initState() {
    super.initState();
    final user = widget.user;
    if (user != null) {
      _username.text = user.username;
      _fullName.text = user.fullName;
      _role = user.role;
    }
  }

  @override
  void dispose() {
    _username.dispose();
    _fullName.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final store = StoreScope.read(context);
    setState(() => _saving = true);
    final message = _editing
        ? await store.updateUser(
            userId: widget.user!.id,
            username: _username.text,
            fullName: _fullName.text,
            role: _role,
            password: _password.text,
          )
        : await store.createUser(
            username: _username.text,
            fullName: _fullName.text,
            password: _password.text,
            role: _role,
          );
    if (!mounted) return;
    setState(() => _saving = false);
    if (message == null) {
      showSuccess(context, _editing ? 'تم تحديث بيانات الحساب.' : 'تم إنشاء حساب المستخدم.');
      Navigator.of(context).pop(true);
    } else {
      showError(context, message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: Text(_editing ? 'تعديل حساب مستخدم' : 'إنشاء حساب مستخدم')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: <Widget>[
          AppPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                TextField(
                  controller: _username,
                  decoration: const InputDecoration(labelText: 'اسم المستخدم * (3 أحرف فأكثر)'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _fullName,
                  decoration: const InputDecoration(labelText: 'الاسم الكامل *'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _password,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: _editing
                        ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)'
                        : 'كلمة المرور * (8 أحرف فأكثر)',
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: _role,
                  decoration: const InputDecoration(labelText: 'الدور'),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem<String>(value: 'admin', child: Text('مدير النظام')),
                    DropdownMenuItem<String>(value: 'contractor', child: Text('متعهد المغسلة')),
                    DropdownMenuItem<String>(value: 'supervisor', child: Text('مشرف السكن')),
                  ],
                  onChanged: (value) => setState(() => _role = value ?? 'contractor'),
                ),
                const SizedBox(height: 12),
                const InfoNote(
                  title: 'الصلاحيات',
                  message: 'مدير النظام: كل الصلاحيات. متعهد المغسلة: إنشاء الطلبات وتسجيل التسليم. مشرف السكن: مراجعة الطلبات واعتماد المستحقات.',
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
            child: Text(_editing ? 'حفظ التعديلات' : 'إنشاء الحساب'),
          ),
        ),
      ),
    );
  }
}

class _ResetPasswordScreen extends StatefulWidget {
  const _ResetPasswordScreen({required this.user});

  final AppUser user;

  @override
  State<_ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<_ResetPasswordScreen> {
  final TextEditingController _password = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final store = StoreScope.read(context);
    setState(() => _saving = true);
    final message = await store.resetUserPassword(widget.user.id, _password.text);
    if (!mounted) return;
    setState(() => _saving = false);
    if (message == null) {
      showSuccess(context, 'تم تغيير كلمة مرور الحساب.');
      Navigator.of(context).pop(true);
    } else {
      showError(context, message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: const Text('تغيير كلمة المرور')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: <Widget>[
          AppPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                DetailRow(label: 'الحساب', value: widget.user.fullName),
                DetailRow(label: 'اسم المستخدم', value: widget.user.username),
                const SizedBox(height: 12),
                TextField(
                  controller: _password,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'كلمة المرور الجديدة * (8 أحرف فأكثر)'),
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
            child: const Text('حفظ كلمة المرور'),
          ),
        ),
      ),
    );
  }
}
