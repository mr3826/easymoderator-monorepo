/**
 * Billing failure / payment reminder email template
 * @param {Object} shop    - Shop object with name, email
 * @param {Object} invoice - Invoice object with id, amount, due_date, payment_link
 * @returns {{ subject: string, html: string, text: string }}
 */
function billingFailureEmail(shop, invoice) {
  const subject = 'পেমেন্ট ব্যর্থ হয়েছে — অ্যাকশন প্রয়োজন | EasyModerator';

  const dueDate = invoice.due_date
    ? new Date(invoice.due_date).toLocaleDateString('bn-BD')
    : 'অবিলম্বে';

  const html = `<!DOCTYPE html>
<html lang="bn">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr>
          <td style="background:#dc2626;padding:24px 32px;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">EasyModerator ⚠️</h1>
            <p style="margin:4px 0 0;color:#fecaca;font-size:13px;">পেমেন্ট ব্যর্থ হয়েছে</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 12px;color:#111;font-size:17px;">
              ${shop?.name || 'প্রিয় ব্যবহারকারী'}, আপনার সাবস্ক্রিপশন পেমেন্ট ব্যর্থ হয়েছে
            </h2>
            <p style="color:#555;font-size:13px;line-height:1.6;">
              আপনার EasyModerator সাবস্ক্রিপশনের পেমেন্ট প্রক্রিয়া করা সম্ভব হয়নি।
              আপনার অ্যাকাউন্ট সক্রিয় রাখতে অবিলম্বে পেমেন্ট করুন।
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#fef2f2;border-radius:8px;padding:16px;border:1px solid #fecaca;">
              <tr>
                <td style="color:#991b1b;font-size:13px;padding:4px 0;">ইনভয়েস নম্বর</td>
                <td style="color:#991b1b;font-size:13px;font-weight:700;text-align:right;">${invoice.id || invoice.invoice_number || '—'}</td>
              </tr>
              <tr>
                <td style="color:#991b1b;font-size:13px;padding:4px 0;">বকেয়া পরিমাণ</td>
                <td style="color:#dc2626;font-size:16px;font-weight:800;text-align:right;">৳${Number(invoice.amount || 0).toLocaleString('bn-BD')}</td>
              </tr>
              <tr>
                <td style="color:#991b1b;font-size:13px;padding:4px 0;">শেষ তারিখ</td>
                <td style="color:#991b1b;font-size:13px;font-weight:700;text-align:right;">${dueDate}</td>
              </tr>
            </table>

            ${invoice.payment_link ? `
            <div style="text-align:center;margin:24px 0;">
              <a href="${invoice.payment_link}"
                 style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;
                        padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
                এখনই পেমেন্ট করুন
              </a>
            </div>` : ''}

            <p style="color:#888;font-size:12px;line-height:1.6;margin-top:20px;">
              পেমেন্ট না হলে আপনার অ্যাকাউন্ট ৩০ দিন পরে <strong>সাসপেন্ড</strong> হতে পারে।
              সাহায্যের জন্য <a href="mailto:support@easymod.tech" style="color:#dc2626;">support@easymod.tech</a> যোগাযোগ করুন।
            </p>
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

  const text = `পেমেন্ট ব্যর্থ | EasyModerator\n\nইনভয়েস: ${invoice.id || '—'}\nবকেয়া: ৳${invoice.amount || 0}\nশেষ তারিখ: ${dueDate}\n${invoice.payment_link ? `পেমেন্ট লিংক: ${invoice.payment_link}` : ''}\n\nসাহায্যের জন্য: support@easymod.tech`;

  return { subject, html, text };
}

module.exports = { billingFailureEmail };
