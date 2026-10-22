import 'package:flutter/material.dart';

import '../models/laundry_models.dart';
import '../state/store_scope.dart';
import '../utils/format.dart';
import '../widgets/app_widgets.dart';

/// الخدمات والأسعار — مطابقة لشاشة `rates.html`.
class RatesScreen extends StatefulWidget {
  const RatesScreen({super.key});

  @override
  State<RatesScreen> createState() => _RatesScreenState();
}

class _RatesScreenState extends State<RatesScreen> {
  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final items = store.serviceItems;

    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push<bool>(
          MaterialPageRoute<bool>(builder: (_) => const _ServiceItemFormScreen()),
        ),
        backgroundColor: AppColors.green,
        foregroundColor: AppColors.white,
        icon: const Icon(Icons.add_rounded),
        label: const Text('خدمة جديدة'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 90),
        children: <Widget>[
          const PageHeading(
            eyebrow: 'إدارة النظام',
            title: 'الخدمات والأسعار',
            subtitle: 'الأسعار التي تُحتسب بها قيمة كل طلب عند تسجيله.',
          ),
          const SizedBox(height: 14),
          const NoticeCard(
            title: 'تنبيه',
            message: 'تعديل السعر يؤثر على الطلبات الجديدة فقط؛ الطلبات السابقة تحتفظ بالسعر المسجل وقت إنشائها.',
          ),
          const SizedBox(height: 14),
          if (items.isEmpty)
            const AppPanel(child: EmptyState(icon: '◇', title: 'لا توجد خدمات مسجلة'))
          else
            for (final item in items)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _ServiceItemCard(item: item),
              ),
        ],
      ),
    );
  }
}

class _ServiceItemCard extends StatelessWidget {
  const _ServiceItemCard({required this.item});

  final ServiceItem item;

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    return AppPanel(
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
                    Text(item.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: AppColors.ink)),
                    Text('${item.code} • ${item.unit}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Text(
                    '${formatMoney(item.rate)} ${store.currency}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.greenDark),
                  ),
                  if (!item.active)
                    const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: StatusPill(status: 'rejected', label: 'معطّلة'),
                    ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: <Widget>[
              TextButton.icon(
                onPressed: () => Navigator.of(context).push<bool>(
                  MaterialPageRoute<bool>(builder: (_) => _ServiceItemFormScreen(item: item)),
                ),
                icon: const Icon(Icons.edit_outlined, size: 16),
                label: const Text('تعديل'),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: () async {
                  final message = await store.toggleServiceItem(item.id);
                  if (!context.mounted) return;
                  if (message == null) {
                    showSuccess(context, 'تم تحديث حالة الخدمة.');
                  } else {
                    showError(context, message);
                  }
                },
                icon: Icon(
                  item.active ? Icons.toggle_off_outlined : Icons.toggle_on_outlined,
                  size: 18,
                  color: item.active ? AppColors.red : AppColors.green,
                ),
                label: Text(item.active ? 'تعطيل' : 'تفعيل'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ServiceItemFormScreen extends StatefulWidget {
  const _ServiceItemFormScreen({this.item});

  final ServiceItem? item;

  @override
  State<_ServiceItemFormScreen> createState() => _ServiceItemFormScreenState();
}

class _ServiceItemFormScreenState extends State<_ServiceItemFormScreen> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _code = TextEditingController();
  final TextEditingController _unit = TextEditingController(text: 'قطعة');
  final TextEditingController _rate = TextEditingController(text: '0');
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final item = widget.item;
    if (item != null) {
      _name.text = item.name;
      _code.text = item.code;
      _unit.text = item.unit;
      _rate.text = formatQuantity(item.rate);
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _code.dispose();
    _unit.dispose();
    _rate.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final store = StoreScope.read(context);
    final rate = double.tryParse(_rate.text.replaceAll(',', ''));
    if (rate == null || rate < 0) {
      showError(context, 'أدخل سعراً صحيحاً غير سالب.');
      return;
    }
    setState(() => _saving = true);
    final message = await store.saveServiceItem(
      id: widget.item?.id,
      code: widget.item == null ? _code.text : widget.item!.code,
      name: _name.text,
      unit: _unit.text,
      rate: rate,
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (message == null) {
      Navigator.of(context).pop(true);
    } else {
      showError(context, message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.item != null;
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: Text(editing ? 'تعديل الخدمة والسعر' : 'إضافة خدمة جديدة')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: <Widget>[
          AppPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                TextField(
                  controller: _name,
                  decoration: const InputDecoration(labelText: 'اسم الخدمة *'),
                ),
                if (!editing) ...<Widget>[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _code,
                    decoration: const InputDecoration(
                      labelText: 'رمز الخدمة *',
                      hintText: 'مثال: WASH_CLOTHES',
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: _unit,
                  decoration: const InputDecoration(labelText: 'وحدة القياس'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _rate,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'السعر *'),
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
            child: Text(editing ? 'حفظ التعديلات' : 'إضافة الخدمة'),
          ),
        ),
      ),
    );
  }
}
