import 'package:flutter/material.dart';

import '../state/store_scope.dart';
import '../widgets/app_widgets.dart';

/// إعدادات النظام — مطابقة لشاشة `settings.html`.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _companyName;
  late final TextEditingController _currency;
  late final TextEditingController _serverUrl;
  bool _saving = false;
  bool _connecting = false;

  @override
  void initState() {
    super.initState();
    final store = StoreScope.read(context);
    _companyName = TextEditingController(text: store.companyName);
    _currency = TextEditingController(text: store.currency);
    _serverUrl = TextEditingController(text: store.baseUrl);
  }

  @override
  void dispose() {
    _companyName.dispose();
    _currency.dispose();
    _serverUrl.dispose();
    super.dispose();
  }

  Future<void> _connectServer() async {
    final store = StoreScope.read(context);
    setState(() => _connecting = true);
    await store.setBaseUrl(_serverUrl.text);
    if (!mounted) return;
    setState(() => _connecting = false);
    if (store.isOnline) {
      showSuccess(context, 'تم الاتصال بالخادم بنجاح.');
    } else {
      showError(context, store.lastSyncError ?? 'تعذّر الاتصال بالخادم على العنوان الجديد.');
    }
  }

  Future<void> _save() async {
    final store = StoreScope.read(context);
    setState(() => _saving = true);
    final message = await store.saveSettings(
      companyName: _companyName.text,
      currency: _currency.text,
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (message == null) {
      showSuccess(context, 'تم حفظ الإعدادات.');
    } else {
      showError(context, message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: const Text('إعدادات النظام')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: <Widget>[
          AppPanel(
            title: 'بيانات النظام',
            subtitle: 'تظهر هذه القيم في رؤوس التقارير والطلبات.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                TextField(
                  controller: _companyName,
                  decoration: const InputDecoration(labelText: 'اسم النظام *'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _currency,
                  decoration: const InputDecoration(labelText: 'العملة *'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          if (store.canManageSystem) ...<Widget>[
            AppPanel(
              title: 'اتصال الخادم',
              subtitle: 'عنوان نشر النظام على Render. هذا الخيار ظاهر لمدير النظام فقط.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  TextField(
                    controller: _serverUrl,
                    keyboardType: TextInputType.url,
                    decoration: const InputDecoration(
                      labelText: 'عنوان الخادم',
                      prefixIcon: Icon(Icons.dns_outlined, size: 20),
                    ),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: _connecting ? null : _connectServer,
                    icon: const Icon(Icons.link_rounded, size: 18),
                    label: Text(_connecting ? 'جارٍ الاتصال…' : 'حفظ العنوان واختبار الاتصال'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],
          AppPanel(
            title: 'معلومات الخادم',
            child: Column(
              children: <Widget>[
                DetailRow(label: 'عنوان الخادم', value: store.baseUrl),
                DetailRow(
                  label: 'حالة الاتصال',
                  value: store.isOnline ? 'متصل' : 'غير متصل',
                  valueWidget: Text(
                    store.isOnline ? 'متصل' : 'غير متصل',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: store.isOnline ? AppColors.green : AppColors.amber,
                    ),
                  ),
                ),
                DetailRow(label: 'عدد الموظفين', value: '${store.employees.length}'),
                DetailRow(label: 'عدد الطلبات', value: '${store.orders.length}'),
                DetailRow(label: 'طلبات بانتظار المزامنة', value: '${store.pendingOrders.length}'),
                if (store.lastSyncError != null)
                  DetailRow(label: 'آخر خطأ مزامنة', value: store.lastSyncError!),
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
            child: const Text('حفظ الإعدادات'),
          ),
        ),
      ),
    );
  }
}
