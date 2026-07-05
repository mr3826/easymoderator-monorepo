/**
 * Password reset email template
 * @param {string} resetLink - Full password reset URL
 * @returns {{ subject: string, html: string, text: string }}
 */
function passwordResetEmail(resetLink) {
  const subject = 'পাসওয়ার্ড রিসেট করুন | EasyModerator';

  const html = `<!DOCTYPE html>
<html lang="bn">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <!-- Header -->
        <tr>
          <td style="background:#2563eb;padding:24px 32px;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">EasyModerator</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 12px;color:#111;font-size:18px;">পাসওয়ার্ড রিসেট অনুরোধ</h2>
            <p style="color:#555;font-size:14px;line-height:1.6;">
              আপনি আপনার EasyModerator অ্যাকাউন্টের পাসওয়ার্ড রিসেট করতে অনুরোধ করেছেন।
              নিচের বাটনে ক্লিক করে নতুন পাসওয়ার্ড সেট করুন:
            </p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${resetLink}"
                 style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                        padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
                পাসওয়ার্ড রিসেট করুন
              </a>
            </div>
            <p style="color:#888;font-size:13px;line-height:1.6;">
              এই লিংকটি <strong>১ ঘণ্টা</strong> পরে মেয়াদোত্তীর্ণ হবে।<br>
              আপনি যদি এই অনুরোধ না করে থাকেন, এই ইমেইলটি উপেক্ষা করুন।
            </p>
            <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;">
            <p style="color:#aaa;font-size:11px;">
              যদি বাটনটি কাজ না করে, এই লিংকটি কপি করুন:<br>
              <a href="${resetLink}" style="color:#2563eb;word-break:break-all;">${resetLink}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
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

  const text = `পাসওয়ার্ড রিসেট করুন | EasyModerator\n\nআপনি পাসওয়ার্ড রিসেটের অনুরোধ করেছেন। নিচের লিংক ব্যবহার করুন:\n\n${resetLink}\n\nএই লিংকটি ১ ঘণ্টা পরে মেয়াদোত্তীর্ণ হবে। আপনি যদি এই অনুরোধ না করে থাকেন, এই ইমেইল উপেক্ষা করুন।`;

  return { subject, html, text };
}

module.exports = { passwordResetEmail };
