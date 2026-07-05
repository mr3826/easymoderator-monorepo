/**
 * Order confirmation email template
 * @param {Object} order  - Order object with items, total, payment_method, delivery_address
 * @param {Object} customer - Customer object with name, phone
 * @returns {{ subject: string, html: string, text: string }}
 */
function orderConfirmationEmail(order, customer) {
  const subject = `অর্ডার নিশ্চিত হয়েছে #${order.order_number || order.id} | EasyModerator`;

  const itemRows = (order.items || [])
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 0;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${item.name || item.product_name || 'Product'}</td>
          <td style="padding:8px 0;color:#333;font-size:13px;text-align:center;border-bottom:1px solid #f0f0f0;">×${item.quantity}</td>
          <td style="padding:8px 0;color:#333;font-size:13px;text-align:right;border-bottom:1px solid #f0f0f0;">৳${Number(item.total || item.price * item.quantity).toLocaleString('bn-BD')}</td>
        </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="bn">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr>
          <td style="background:#16a34a;padding:24px 32px;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">EasyModerator ✓</h1>
            <p style="margin:4px 0 0;color:#bbf7d0;font-size:13px;">অর্ডার নিশ্চিত হয়েছে</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 4px;color:#111;font-size:17px;">
              ${customer?.name || 'প্রিয় গ্রাহক'}, ধন্যবাদ! 🎉
            </h2>
            <p style="color:#555;font-size:13px;margin:0 0 20px;">
              অর্ডার নম্বর: <strong>#${order.order_number || order.id}</strong>
            </p>

            <!-- Items -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <thead>
                <tr>
                  <th style="text-align:left;color:#888;font-size:12px;padding-bottom:8px;border-bottom:2px solid #e4e4e7;">পণ্য</th>
                  <th style="text-align:center;color:#888;font-size:12px;padding-bottom:8px;border-bottom:2px solid #e4e4e7;">পরিমাণ</th>
                  <th style="text-align:right;color:#888;font-size:12px;padding-bottom:8px;border-bottom:2px solid #e4e4e7;">মূল্য</th>
                </tr>
              </thead>
              <tbody>${itemRows}</tbody>
              <tfoot>
                <tr>
                  <td colspan="2" style="padding:12px 0;font-weight:700;color:#111;font-size:14px;">মোট</td>
                  <td style="padding:12px 0;font-weight:700;color:#16a34a;font-size:16px;text-align:right;">
                    ৳${Number(order.total || 0).toLocaleString('bn-BD')}
                  </td>
                </tr>
              </tfoot>
            </table>

            <!-- Details -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#f9fafb;border-radius:8px;padding:16px;border:1px solid #e4e4e7;">
              <tr>
                <td style="color:#555;font-size:13px;padding:4px 0;">💳 পেমেন্ট পদ্ধতি</td>
                <td style="color:#111;font-size:13px;font-weight:600;text-align:right;padding:4px 0;">
                  ${order.payment_method || 'COD'}
                </td>
              </tr>
              <tr>
                <td style="color:#555;font-size:13px;padding:4px 0;">📍 ডেলিভারি ঠিকানা</td>
                <td style="color:#111;font-size:13px;text-align:right;padding:4px 0;">
                  ${order.delivery_address || order.customer_address || '—'}
                </td>
              </tr>
              ${customer?.phone ? `<tr>
                <td style="color:#555;font-size:13px;padding:4px 0;">📞 ফোন</td>
                <td style="color:#111;font-size:13px;text-align:right;padding:4px 0;">${customer.phone}</td>
              </tr>` : ''}
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e4e4e7;">
            <p style="margin:0;color:#aaa;font-size:11px;text-align:center;">
              © 2025 EasyModerator — Messenger sales and order automation
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `অর্ডার নিশ্চিত #${order.order_number || order.id}\n\nধন্যবাদ ${customer?.name || ''}!\n\nমোট: ৳${order.total || 0}\nপেমেন্ট: ${order.payment_method || 'COD'}\nঠিকানা: ${order.delivery_address || order.customer_address || '—'}`;

  return { subject, html, text };
}

module.exports = { orderConfirmationEmail };
