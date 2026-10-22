import 'package:flutter/material.dart';

import '../state/store_scope.dart';
import '../widgets/app_widgets.dart';

/// حسابي وكلمة المرور — مطابقة لشاشة `account.html`.
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key});

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final TextEditingController _oldPassword = TextEditingController();
  final TextEditingController _newPassword = TextEditingController();
  final TextEditingController _confirmPassword = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _oldPassword.dispose();
    _newPassword.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_newPassword.text != _confirmPassword.text) {
      showError(context, 'تأكيد كلمة المرور غير مطابق.');
      return;
    }
    final store = StoreScope.read(context);
    setState(() => _saving = true);
    final message = await store.changePassword(_oldPassword.text, _newPassword.text);
    if (!mounted) return;
    setState(() => _saving = false);
    if (message == null) {
      showSuccess(context, 'تم تغيير كلمة المرور بنجاح.');
      _oldPassword.clear();
      _newPassword.clear();
      _confirmPassword.clear();
    } else {
      showError(context, message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final user = store.currentUser;

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: const Text('حسابي وكلمة المرور')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: <Widget>[
          AppPanel(
            title: 'بيانات الحساب',
            child: Column(
              children: <Widget>[
                DetailRow(label: 'الاسم', value: user?.fullName ?? '—'),
                DetailRow(label: 'اسم المستخدم', value: user?.username ?? '—'),
                DetailRow(label: 'الدور', value: user?.roleLabel ?? '—'),
              ],
            ),
          ),
          const SizedBox(height: 14),
          AppPanel(
            title: 'تغيير كلمة المرور',
            subtitle: '8 أحرف على الأقل.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                TextField(
                  controller: _oldPassword,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'كلمة المرور الحالية *'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _newPassword,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'كلمة المرور الجديدة *'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _confirmPassword,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'تأكيد كلمة المرور *'),
                ),
                const SizedBox(height: 14),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: const Text('حفظ كلمة المرور'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
