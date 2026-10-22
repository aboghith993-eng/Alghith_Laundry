import 'package:flutter/material.dart';

import '../state/laundry_store.dart';
import '../state/shell_scope.dart';
import '../state/store_scope.dart';
import '../widgets/app_widgets.dart';
import 'dashboard_screen.dart';
import 'employees_screen.dart';
import 'more_screen.dart';
import 'orders_screen.dart';
import 'reports_screen.dart';

/// الشل الرئيسي — يعرض التبويبات حسب صلاحية المستخدم (نفس قائمة الويب الجانبية).
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  AppTab _tab = AppTab.dashboard;
  String _ordersStatus = 'all';
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();

  void _switchTo(AppTab tab, {String? ordersStatus}) {
    setState(() {
      _tab = tab;
      if (ordersStatus != null) _ordersStatus = ordersStatus;
    });
    _navigatorKey.currentState?.pushReplacement(
      MaterialPageRoute<void>(builder: (_) => _screenFor(_tab)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final tabs = store.availableTabs;

    return Scaffold(
      body: Column(
        children: <Widget>[
          AppHeader(
            title: _titleFor(_tab, store),
            userName: store.currentUser?.fullName ?? '',
            roleLabel: store.currentUser?.roleLabel ?? '',
            online: store.isOnline,
            refreshing: store.isSyncing,
            onRefresh: () => store.syncNow(),
            actions: <Widget>[
              if (store.hasPendingUploads)
                Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: Tooltip(
                    message: 'طلبات بانتظار المزامنة',
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                      decoration: BoxDecoration(
                        color: AppColors.softAmber,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: AppColors.amber.withValues(alpha: .3)),
                      ),
                      child: Text(
                        '${store.pendingOrders.length} معلق',
                        style: const TextStyle(color: AppColors.amber, fontSize: 11.5, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                ),
            ],
          ),
          Expanded(
            child: ShellScope(
              switchTab: _switchTo,
              child: Navigator(
                key: _navigatorKey,
                onGenerateRoute: (settings) {
                  return MaterialPageRoute<void>(
                    settings: settings,
                    builder: (_) => _screenFor(_tab),
                  );
                },
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tabs.indexOf(_tab).clamp(0, tabs.length - 1),
        onDestinationSelected: (index) => _switchTo(tabs[index]),
        destinations: <Widget>[
          for (final tab in tabs)
            NavigationDestination(
              icon: Icon(_iconFor(tab)),
              selectedIcon: Icon(_iconFor(tab), color: AppColors.green),
              label: _labelFor(tab),
            ),
        ],
      ),
    );
  }

  Widget _screenFor(AppTab tab) => switch (tab) {
        AppTab.dashboard => const DashboardScreen(),
        AppTab.orders => OrdersScreen(initialStatus: _ordersStatus),
        AppTab.employees => const EmployeesScreen(),
        AppTab.reports => const ReportsScreen(),
        AppTab.more => const MoreScreen(),
      };

  String _labelFor(AppTab tab) => switch (tab) {
        AppTab.dashboard => 'المتابعة',
        AppTab.orders => 'الطلبات',
        AppTab.employees => 'الموظفون',
        AppTab.reports => 'التقارير',
        AppTab.more => 'المزيد',
      };

  IconData _iconFor(AppTab tab) => switch (tab) {
        AppTab.dashboard => Icons.dashboard_outlined,
        AppTab.orders => Icons.receipt_long_outlined,
        AppTab.employees => Icons.groups_outlined,
        AppTab.reports => Icons.bar_chart_outlined,
        AppTab.more => Icons.more_horiz_rounded,
      };

  String _titleFor(AppTab tab, LaundryStore store) => switch (tab) {
        AppTab.dashboard => 'لوحة المتابعة',
        AppTab.orders => 'طلبات المغسلة',
        AppTab.employees => 'قاعدة الموظفين',
        AppTab.reports => 'التقارير والمستحقات',
        AppTab.more => store.canManageSystem ? 'إدارة النظام' : 'حسابي',
      };
}
