/// نظام التصميم — مطابق لملف `static/css/app.css` في تطبيق الويب.
library;

import 'package:flutter/material.dart';

/// رموز التصميم المستخرجة من تطبيق الويب.
class AppColors {
  AppColors._();

  static const Color ink = Color(0xFF152D2B);
  static const Color muted = Color(0xFF71817F);
  static const Color green = Color(0xFF126B58);
  static const Color greenDark = Color(0xFF0B4C40);
  static const Color mint = Color(0xFFE9F5F0);
  static const Color bg = Color(0xFFF4F7F6);
  static const Color line = Color(0xFFE1E9E5);
  static const Color white = Color(0xFFFFFFFF);
  static const Color amber = Color(0xFF97651A);
  static const Color red = Color(0xFFA63C3C);
  static const Color blue = Color(0xFF2B6497);
  static const Color focus = Color(0xFF8CCEBA);

  static const LinearGradient brand = LinearGradient(
    begin: Alignment.topRight,
    end: Alignment.bottomLeft,
    colors: <Color>[Color(0xFF187C65), Color(0xFF0B4B40)],
  );

  /// لون الخلفية البسيطة المستعملة في بطاقات لوحة المتابعة.
  static const Color softTeal = Color(0xFFEAF4F1);
  static const Color softAmber = Color(0xFFFBF3E4);
  static const Color softBlue = Color(0xFFEAF1F8);
  static const Color softGreen = Color(0xFFE9F5F0);
}

class AppRadius {
  AppRadius._();

  static const double card = 16;
  static const double control = 11;
}

/// الثوابت العامة للتطبيق.
class AppTheme {
  AppTheme._();

  static const String fontFamily = 'IBMPlexSansArabic';

  static ThemeData build() {
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      fontFamily: fontFamily,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.green,
        primary: AppColors.green,
        surface: AppColors.white,
        error: AppColors.red,
      ),
      scaffoldBackgroundColor: AppColors.bg,
    );

    return base.copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.ink,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: fontFamily,
          fontSize: 17,
          fontWeight: FontWeight.w700,
          color: AppColors.ink,
        ),
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        color: AppColors.white,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.card),
          side: const BorderSide(color: AppColors.line),
        ),
      ),
      dividerTheme: const DividerThemeData(color: AppColors.line, thickness: 1, space: 1),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.white,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        hintStyle: const TextStyle(color: AppColors.muted, fontSize: 14),
        labelStyle: const TextStyle(color: AppColors.muted, fontSize: 13),
        floatingLabelStyle: const TextStyle(color: AppColors.green, fontSize: 13),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.control),
          borderSide: const BorderSide(color: Color(0xFFDCE6E1)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.control),
          borderSide: const BorderSide(color: AppColors.focus, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.control),
          borderSide: const BorderSide(color: AppColors.red),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.control),
          borderSide: const BorderSide(color: AppColors.red, width: 1.6),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.green,
          foregroundColor: AppColors.white,
          minimumSize: const Size(0, 46),
          padding: const EdgeInsets.symmetric(horizontal: 20),
          textStyle: const TextStyle(
            fontFamily: fontFamily,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.control),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.green,
          minimumSize: const Size(0, 46),
          side: const BorderSide(color: AppColors.line),
          padding: const EdgeInsets.symmetric(horizontal: 18),
          textStyle: const TextStyle(
            fontFamily: fontFamily,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.control),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.green,
          textStyle: const TextStyle(
            fontFamily: fontFamily,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      navigationBarTheme: const NavigationBarThemeData(
        backgroundColor: AppColors.white,
        surfaceTintColor: Colors.transparent,
        indicatorColor: AppColors.mint,
        height: 66,
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(fontFamily: fontFamily, fontSize: 12, color: AppColors.ink),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.ink,
        contentTextStyle: const TextStyle(fontFamily: fontFamily, fontSize: 14, color: AppColors.white),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      textTheme: const TextTheme(
        displaySmall: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: AppColors.ink, height: 1.35),
        headlineSmall: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.ink, height: 1.4),
        titleLarge: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.ink, height: 1.4),
        titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.ink, height: 1.5),
        bodyLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w400, color: AppColors.ink, height: 1.7),
        bodyMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w400, color: AppColors.ink, height: 1.7),
        bodySmall: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w400, color: AppColors.muted, height: 1.6),
        labelLarge: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: AppColors.ink),
      ),
    );
  }
}

/// لوحة بزاوية مستديرة — تحاكي `.panel` في الويب.
class AppPanel extends StatelessWidget {
  const AppPanel({
    super.key,
    required this.child,
    this.title,
    this.subtitle,
    this.trailing,
    this.padding = const EdgeInsets.all(16),
  });

  final Widget child;
  final String? title;
  final String? subtitle;
  final Widget? trailing;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final hasHeading = title != null || subtitle != null || trailing != null;
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (hasHeading)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        if (title != null)
                          Text(title!, style: Theme.of(context).textTheme.titleLarge),
                        if (subtitle != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(subtitle!, style: Theme.of(context).textTheme.bodySmall),
                          ),
                      ],
                    ),
                  ),
                  if (trailing != null) trailing!,
                ],
              ),
            ),
          if (hasHeading)
            const Divider(height: 1, color: AppColors.line),
          Padding(padding: padding, child: child),
        ],
      ),
    );
  }
}

/// عنوان صفحة مع عنوان فرعي وإجراء اختياري.
class PageHeading extends StatelessWidget {
  const PageHeading({
    super.key,
    required this.title,
    this.eyebrow,
    this.subtitle,
    this.action,
  });

  final String title;
  final String? eyebrow;
  final String? subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (eyebrow != null)
          Text(
            eyebrow!,
            style: const TextStyle(
              color: AppColors.green,
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              letterSpacing: .2,
            ),
          ),
        const SizedBox(height: 4),
        Text(title, style: Theme.of(context).textTheme.displaySmall),
        if (subtitle != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(subtitle!, style: Theme.of(context).textTheme.bodySmall),
          ),
        if (action != null)
          Padding(padding: const EdgeInsets.only(top: 14), child: action),
      ],
    );
  }
}

/// بطاقة مؤشر — تحاكي `.metric-card`.
class MetricCard extends StatelessWidget {
  const MetricCard({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.hint,
    this.color = AppColors.green,
  });

  final String icon;
  final String label;
  final String value;
  final String? hint;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Text(icon, style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(height: 10),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: AlignmentDirectional.centerStart,
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
          ),
          if (hint != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(hint!, style: Theme.of(context).textTheme.bodySmall),
            ),
        ],
      ),
    );
  }
}

/// شارة حالة الطلب.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.status, this.label});

  final String status;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final (color, background, text) = switch (status) {
      'approved' => (AppColors.green, AppColors.mint, 'معتمد'),
      'rejected' => (AppColors.red, const Color(0xFFFBEDED), 'مرفوض'),
      _ => (AppColors.amber, const Color(0xFFFBF3E4), 'بانتظار التأكيد'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: .25)),
      ),
      child: Text(
        label ?? text,
        style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }
}

/// حالة فارغة — تحاكي `.empty-state`.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.action,
  });

  final String icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 26, horizontal: 12),
      child: Column(
        children: <Widget>[
          Text(icon, style: const TextStyle(fontSize: 30, color: AppColors.muted)),
          const SizedBox(height: 8),
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          if (message != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(message!, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
            ),
          if (action != null) Padding(padding: const EdgeInsets.only(top: 14), child: action),
        ],
      ),
    );
  }
}

/// بطاقة تنبيه مهم — تحاكي `.notice-card`.
class NoticeCard extends StatelessWidget {
  const NoticeCard({super.key, required this.title, required this.message, this.icon = '!'});

  final String title;
  final String message;
  final String icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.softAmber,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.amber.withValues(alpha: .28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 22,
                height: 22,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: AppColors.amber, shape: BoxShape.circle),
                child: Text(icon, style: const TextStyle(color: AppColors.white, fontSize: 13, fontWeight: FontWeight.w700)),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(color: AppColors.amber, fontWeight: FontWeight.w700, fontSize: 13.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(message, style: const TextStyle(color: AppColors.ink, fontSize: 13, height: 1.7)),
        ],
      ),
    );
  }
}

/// ملاحظة معلوماتية — تحاكي `.info-note`.
class InfoNote extends StatelessWidget {
  const InfoNote({super.key, required this.title, required this.message});

  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.mint,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.focus.withValues(alpha: .45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: const TextStyle(color: AppColors.greenDark, fontWeight: FontWeight.w700, fontSize: 13.5)),
          const SizedBox(height: 4),
          Text(message, style: const TextStyle(color: AppColors.ink, fontSize: 13, height: 1.7)),
        ],
      ),
    );
  }
}

/// صف بيانات (تسمية + قيمة) — يُستخدم في تفاصيل الطلب والموظف.
class DetailRow extends StatelessWidget {
  const DetailRow({super.key, required this.label, required this.value, this.valueWidget});

  final String label;
  final String value;
  final Widget? valueWidget;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 132,
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          Expanded(
            child: valueWidget ??
                Text(
                  value,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.ink, height: 1.6),
                ),
          ),
        ],
      ),
    );
  }
}

/// ترويسة الشاشات مع اسم المستخدم والدور.
class AppHeader extends StatelessWidget {
  const AppHeader({
    super.key,
    required this.title,
    required this.userName,
    required this.roleLabel,
    this.onRefresh,
    this.refreshing = false,
    this.actions = const <Widget>[],
    this.online = true,
  });

  final String title;
  final String userName;
  final String roleLabel;
  final VoidCallback? onRefresh;
  final bool refreshing;
  final List<Widget> actions;
  final bool online;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.white,
        border: Border(bottom: BorderSide(color: AppColors.line)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
      child: Row(
        children: <Widget>[
          Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              gradient: AppColors.brand,
              borderRadius: BorderRadius.circular(11),
            ),
            child: const Text('غ', style: TextStyle(color: AppColors.white, fontWeight: FontWeight.w700, fontSize: 18)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title, style: Theme.of(context).textTheme.titleMedium),
                Row(
                  children: <Widget>[
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: online ? AppColors.green : AppColors.amber,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 5),
                    Flexible(
                      child: Text(
                        '$userName • $roleLabel',
                        style: Theme.of(context).textTheme.bodySmall,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          ...actions,
          if (onRefresh != null)
            IconButton(
              tooltip: 'تحديث',
              onPressed: refreshing ? null : onRefresh,
              icon: refreshing
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh_rounded, color: AppColors.green),
            ),
        ],
      ),
    );
  }
}

/// يعرض رسالة SnackBar موحّدة.
void showAppSnack(BuildContext context, String message, {bool isError = false}) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: isError ? AppColors.red : AppColors.ink,
      duration: Duration(seconds: isError ? 4 : 3),
    ),
  );
}

/// يعرض رسالة نجاح.
void showSuccess(BuildContext context, String message) =>
    showAppSnack(context, message, isError: false);

/// يعرض رسالة خطأ.
void showError(BuildContext context, String message) =>
    showAppSnack(context, message, isError: true);

/// حقل بحث بزر مسح.
class SearchField extends StatelessWidget {
  const SearchField({
    super.key,
    required this.controller,
    required this.hint,
    this.onChanged,
  });

  final TextEditingController controller;
  final String hint;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: hint,
        prefixIcon: const Icon(Icons.search_rounded, size: 20, color: AppColors.muted),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.close_rounded, size: 18, color: AppColors.muted),
                onPressed: () {
                  controller.clear();
                  onChanged?.call('');
                },
              ),
      ),
    );
  }
}
