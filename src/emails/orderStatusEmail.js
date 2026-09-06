// Email sent to a customer whenever their order status changes.
// For 'cancelled' orders, includes the admin's rejection reason.

const STATUS_LABELS = {
  pending: { label: 'Pending', color: '#6b7280', banner: '#f3f4f6', text: '#374151' },
  'in-review': { label: 'In Review', color: '#0369a1', banner: '#eff6ff', text: '#1e3a8a' },
  processing: { label: 'Processing', color: '#7c3aed', banner: '#f5f3ff', text: '#5b21b6' },
  completed: { label: 'Completed', color: '#059669', banner: '#ecfdf5', text: '#065f46' },
  cancelled: { label: 'Cancelled', color: '#dc2626', banner: '#fef2f2', text: '#991b1b' },
};

exports.orderStatusEmail = ({ name, orderNumber, oldStatus, newStatus, totalAmount, reason }) => {
  const style = STATUS_LABELS[newStatus] || STATUS_LABELS.pending;
  const oldLabel = STATUS_LABELS[oldStatus]?.label || oldStatus;

  const reasonBlock = reason
    ? `
              <div style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#991b1b;letter-spacing:0.06em;text-transform:uppercase;">Reason for cancellation</p>
                <p style="margin:0;font-size:14px;color:#7f1d1d;line-height:1.7;">${reason}</p>
              </div>`
    : '';

  const refundBlock = '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Order ${orderNumber} — ${style.label}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">

          <!-- Header -->
          <tr>
            <td style="background-color:#111827;padding:28px 40px;">
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">ShopLogs</p>
              <p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">Order update</p>
            </td>
          </tr>

          <!-- Status banner -->
          <tr>
            <td style="background-color:${style.banner};border-bottom:1px solid ${style.color}22;padding:14px 40px;">
              <p style="margin:0;font-size:13px;font-weight:600;color:${style.text};">Order ${orderNumber} is now <strong style="color:${style.color};">${style.label}</strong></p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;letter-spacing:-0.3px;">Hi ${name},</h1>
              <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
                Your order <strong>${orderNumber}</strong> moved from <strong>${oldLabel}</strong> to <strong style="color:${style.color};">${style.label}</strong>.
              </p>

              <!-- Order summary -->
              <div style="background-color:#f9fafb;border:1px solid #e4e4e7;border-radius:10px;padding:20px;margin-bottom:24px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#9ca3af;letter-spacing:0.06em;text-transform:uppercase;">Order details</p>
                <p style="margin:0;font-size:14px;color:#374151;line-height:1.8;">
                  Number: <strong style="color:#111827;">${orderNumber}</strong><br/>
                  Total: <strong style="color:#111827;">$${Number(totalAmount).toFixed(2)}</strong><br/>
                  Status: <strong style="color:${style.color};">${style.label}</strong>
                </p>
              </div>

              ${reasonBlock}
              ${refundBlock}

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#111827;border-radius:50px;padding:13px 28px;">
                    <a href="https://shoplogshere.com/orders" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">View My Orders &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #f4f4f5;margin:0;" /></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                &copy; ${new Date().getFullYear()} ShopLogs. All rights reserved.<br/>
                Questions? Reply to this email and our team will help.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
};
