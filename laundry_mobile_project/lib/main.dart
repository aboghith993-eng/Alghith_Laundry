import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'config/app_config.dart';
import 'screens/login_screen.dart';
import 'screens/main_shell.dart';
import 'state/laundry_store.dart';
import 'state/store_scope.dart';
import 'widgets/app_widgets.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const LaundryApp());
}

class LaundryApp extends StatefulWidget {
  const LaundryApp({super.key});

  @override
  State<LaundryApp> createState() => _LaundryAppState();
}

class _LaundryAppState extends State<LaundryApp> {
  late final LaundryStore _store = LaundryStore();

  @override
  void dispose() {
    _store.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return StoreScope(
      store: _store,
      child: MaterialApp(
        title: AppConfig.appName,
        debugShowCheckedModeBanner: false,
        theme: AppTheme.build(),
        locale: const Locale('ar'),
        supportedLocales: const <Locale>[Locale('ar'), Locale('en')],
        localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (context, child) => Directionality(
          textDirection: TextDirection.rtl,
          child: MediaQuery.withClampedTextScaling(
            minScaleFactor: 0.85,
            maxScaleFactor: 1.3,
            child: child ?? const SizedBox.shrink(),
          ),
        ),
        home: const RootGate(),
      ),
    );
  }
}

/// يوجّه بين شاشة الدخول ولوحة التطبيق حسب حالة الجلسة.
class RootGate extends StatelessWidget {
  const RootGate({super.key});

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 250),
      child: store.isLoggedIn
          ? const MainShell(key: ValueKey<String>('shell'))
          : const LoginScreen(key: ValueKey<String>('login')),
    );
  }
}
