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
  final TextEditingController _serverUrl = TextEditingController();
  bool _busy = false;
  bool _serverBusy = false;
  bool _showServer = false;
  String? _error;
  String? _serverStatus;
  bool _serverOk = false;
  bool _serverInitialized = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_serverInitialized) {
      _serverInitialized = true;
      _serverUrl.text = StoreScope.of(context).baseUrl;
    }
  }

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _serverUrl.dispose();
    super.dispose();
  }

  /// فحص/تبديل عنوان الخادم قبل تسجيل الدخول.
  Future<void> _connectServer() async {
    final store = StoreScope.read(context);
    final url = _serverUrl.text.trim();
    if (url.isEmpty) {
      setState(() {
        _serverStatus = 'اكتب عنوان الخادم.';
        _serverOk = false;
      });
      return;
    }
    setState(() {
      _serverBusy = true;
      _serverStatus = null;
    });
    await store.setBaseUrl(url);
    if (!mounted) return;
    setState(() {
      _serverBusy = false;
      _serverOk = store.isOnline;
      _serverStatus = store.isOnline
          ? 'تم الاتصال بالخادم بنجاح.'
          : (store.lastSyncError ?? 'تعذّر الاتصال بهذا العنوان.');
    });
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
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton.icon(
                        onPressed: () => setState(() => _showServer = !_showServer),
                        icon: const Icon(Icons.dns_outlined, size: 18, color: AppColors.muted),
                        label: Text(
                          _showServer ? 'إخفاء عنوان الخادم' : 'تغيير عنوان الخادم',
                          style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                        ),
                      ),
                    ),
                    if (_showServer) ...<Widget>[
                      TextField(
                        controller: _serverUrl,
                        keyboardType: TextInputType.url,
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) => _connectServer(),
                        decoration: InputDecoration(
                          labelText: 'عنوان الخادم',
                          helperText: 'مثال: https://alghith-laundry.onrender.com أو http://192.168.0.100:5505',
                          suffixIcon: TextButton(
                            onPressed: _serverBusy ? null : _connectServer,
                            child: _serverBusy
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Text('فحص', style: TextStyle(fontSize: 12.5)),
                          ),
                        ),
                      ),
                      if (_serverStatus != null) ...<Widget>[
                        const SizedBox(height: 8),
                        Text(
                          _serverStatus!,
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: _serverOk ? AppColors.green : AppColors.red,
                          ),
                        ),
                      ],
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
