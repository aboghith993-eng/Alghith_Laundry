import 'package:flutter/material.dart';

import '../state/store_scope.dart';
import '../widgets/app_widgets.dart';
import 'account_screen.dart';
import 'rates_screen.dart';
import 'settings_screen.dart';
import 'users_screen.dart';

/// تبويب «المزيد» — يجمع أقسام إدارة النظام وحسابي.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final user = store.currentUser;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: <Widget>[
        const PageHeading(
          eyebrow: 'القائمة الرئيسية',
          title: 'المزيد',
          subtitle: 'أقسام إدارة النظام والحساب الشخصي.',
        ),
        const SizedBox(height: 14),
        AppPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Container(
                    width: 44,
                    height: 44,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      gradient: AppColors.brand,
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: Text(
                      user?.fullName.isNotEmpty == true ? user!.fullName.characters.first : '؟',
                      style: const TextStyle(color: AppColors.white, fontWeight: FontWeight.w700, fontSize: 19),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(user?.fullName ?? '', style: Theme.of(context).textTheme.titleLarge),
                        Text(
                          '${user?.username ?? ''} • ${user?.roleLabel ?? ''}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        if (store.canManageSystem) ...<Widget>[
          AppPanel(
            title: 'إدارة النظام',
            child: Column(
              children: <Widget>[
                _MenuTile(
                  icon: '◇',
                  title: 'الخدمات والأسعار',
                  subtitle: 'تعديل أسعار الخدمات المستخدمة في الطلبات',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const RatesScreen()),
                  ),
                ),
                _MenuTile(
                  icon: '♧',
                  title: 'المستخدمون والصلاحيات',
                  subtitle: 'إنشاء حسابات الدخول وتحديد الأدوار',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const UsersScreen()),
                  ),
                ),
                _MenuTile(
                  icon: '⚙',
                  title: 'إعدادات النظام',
                  subtitle: 'اسم النظام والعملة',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const SettingsScreen()),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
        ],
        AppPanel(
          title: 'الحساب',
          child: Column(
            children: <Widget>[
              _MenuTile(
                icon: '◉',
                title: 'حسابي وكلمة المرور',
                subtitle: 'تغيير كلمة مرور الدخول',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const AccountScreen()),
                ),
              ),
              _MenuTile(
                icon: '⤓',
                title: 'مزامنة البيانات',
                subtitle: 'تحديث البيانات المحفوظة على الجهاز من الخادم',
                onTap: () async {
                  await store.syncNow();
                  if (!context.mounted) return;
                  showAppSnack(
                    context,
                    store.lastSyncError ?? 'تمت المزامنة بنجاح.',
                    isError: store.lastSyncError != null,
                  );
                },
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        OutlinedButton.icon(
          onPressed: () async {
            await store.logout();
            if (context.mounted) {
              showAppSnack(context, 'تم تسجيل الخروج.');
            }
          },
          icon: const Icon(Icons.logout_rounded, size: 18, color: AppColors.red),
          label: const Text('تسجيل الخروج', style: TextStyle(color: AppColors.red)),
        ),
        const SizedBox(height: 14),
        const Center(
          child: Text(
            'نظام مغسلة الشركة\nسجل الطلبات · اعتماد السكن · تقرير المستحقات',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: AppColors.muted, height: 1.8),
          ),
        ),
      ],
    );
  }
}

class _MenuTile extends StatelessWidget {
  const _MenuTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final String icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: <Widget>[
            Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.mint,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Text(icon, style: const TextStyle(color: AppColors.greenDark, fontWeight: FontWeight.w700, fontSize: 16)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AppColors.ink)),
                  Text(subtitle, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                ],
              ),
            ),
            const Icon(Icons.chevron_left_rounded, size: 20, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}
