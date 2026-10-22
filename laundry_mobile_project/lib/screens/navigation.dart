import 'package:flutter/material.dart';

import 'order_detail_screen.dart';

/// الانتقال إلى تفاصيل طلب من أي شاشة.
void openOrderDetail(BuildContext context, int orderId) {
  Navigator.of(context).push(
    MaterialPageRoute<void>(builder: (_) => OrderDetailScreen(orderId: orderId)),
  );
}
