import 'package:flutter/material.dart';

import '../config/app_config.dart';
import '../state/store_scope.dart';
import '../widgets/app_widgets.dart';

/// شاشة الدخول — مطابقة لشاشة `login.html` في تطبيق الويب.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _username = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _server = TextEditingController();
  bool _busy = false;
  bool _showServer = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _server.text = StoreScope.read(context).baseUrl;
  }

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final store = StoreScope.read(context);
    final username = _username.text.trim();
    final password = _password.text;
    if (username.isEmpty || password.isEmpty) {
      setState(() => _error = 'اكتب اسم المستخدم وكلمة المرور.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final message = await store.login(username, password);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = message;
    });
  }

  Future<void> _applyServer() async {
    final store = StoreScope.read(context);
    setState(() => _busy = true);
    await store.setBaseUrl(_server.text.trim());
    if (!mounted) return;
    setState(() => _busy = false);
    showAppSnack(
      context,
      store.isOnline ? 'تم الاتصال بالخادم بنجاح.' : 'تعذّر الاتصال بالخادم على العنوان الجديد.',
      isError: !store.isOnline,
    );
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 28, 20, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Center(
                child: Container(
                  width: 68,
                  height: 68,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    gradient: AppColors.brand,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text('غ', style: TextStyle(color: AppColors.white, fontSize: 32, fontWeight: FontWeight.w700)),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                AppConfig.appName,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.displaySmall,
              ),
              const SizedBox(height: 4),
              Text(
                'إدارة خدمات الغسيل والكي ومفروشات السكن',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 24),
              AppPanel(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    TextField(
                      controller: _username,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'اسم المستخدم',
                        prefixIcon: Icon(Icons.person_outline_rounded, size: 20, color: AppColors.muted),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      obscureText: true,
                      onSubmitted: (_) => _submit(),
                      decoration: const InputDecoration(
                        labelText: 'كلمة المرور',
                        prefixIcon: Icon(Icons.lock_outline_rounded, size: 20, color: AppColors.muted),
                      ),
                    ),
                    if (_showServer) ...<Widget>[
                      const SizedBox(height: 12),
                      TextField(
                        controller: _server,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                          labelText: 'عنوان الخادم',
                          prefixIcon: Icon(Icons.dns_outlined, size: 20, color: AppColors.muted),
                        ),
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _applyServer,
                        icon: const Icon(Icons.link_rounded, size: 18),
                        label: const Text('حفظ العنوان والاتصال'),
                      ),
                    ],
                    if (_error != null) ...<Widget>[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFBEDED),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.red.withValues(alpha: .3)),
                        ),
                        child: Text(
                          _error!,
                          style: const TextStyle(color: AppColors.red, fontSize: 13, height: 1.6),
                        ),
                      ),
                    ],
                    const SizedBox(height: 18),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.white),
                            )
                          : const Text('تسجيل الدخول'),
                    ),
                    const SizedBox(height: 8),
                    TextButton.icon(
                      onPressed: () => setState(() => _showServer = !_showServer),
                      icon: const Icon(Icons.settings_ethernet_rounded, size: 18),
                      label: Text(_showServer ? 'إخفاء إعدادات الخادم' : 'إعدادات الخادم'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Container(
                    width: 7,
                    height: 7,
                    decoration: BoxDecoration(
                      color: store.isOnline ? AppColors.green : AppColors.amber,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    store.isOnline ? 'متصل بالخادم' : 'غير متصل — البيانات المحفوظة على الجهاز',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
