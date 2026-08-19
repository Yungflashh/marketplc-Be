exports.fraudWarningEmail = ({ name, failedCount }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Important account warning — ShopLogs</title>
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
              <p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">Account Warning</p>
            </td>
          </tr>

          <!-- Alert banner -->
          <tr>
            <td style="background-color:#fef2f2;border-bottom:1px solid #fecaca;padding:14px 40px;">
              <p style="margin:0;font-size:13px;font-weight:600;color:#991b1b;">&#9888; Warning — suspicious wallet funding activity detected</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;letter-spacing:-0.3px;">Hi ${name},</h1>
              <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
                We have reviewed recent wallet funding requests on your ShopLogs account and identified
                <strong>${failedCount}</strong> transaction${failedCount === 1 ? '' : 's'} that could not be verified — payments were marked as sent but never received at our wallet.
              </p>

              <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
                This is a formal warning. Submitting funding requests without actually sending the corresponding payment is considered fraudulent activity and is a violation of our terms of service.
              </p>

              <!-- Consequence box -->
              <div style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#9a3412;letter-spacing:0.06em;text-transform:uppercase;">What happens next</p>
                <p style="margin:0;font-size:14px;color:#7c2d12;line-height:1.7;">
                  If we detect another fraudulent funding attempt from your account, your access to the ShopLogs dashboard will be <strong>suspended</strong>, and any pending balance may be forfeited pending review.
                </p>
              </div>

              <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">
                If you believe this warning was sent in error — for example, a payment was sent from your side but not credited — please reply to this email with proof of transfer (transaction hash, receipt, or screenshot) and our team will investigate.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#111827;border-radius:50px;padding:13px 28px;">
                    <a href="https://shoplogshere.com/wallet" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">Review My Wallet &rarr;</a>
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
                This is an automated warning sent by the ShopLogs trust &amp; safety team.
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
