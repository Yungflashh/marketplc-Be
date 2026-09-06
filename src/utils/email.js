const { Resend } = require('resend');  // <-- note the destructuring
const dotenv = require('dotenv');
const { notify, escapeHtml } = require('./telegram');

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

// Debounce email-failure alerts so a bad recipient doesn't flood Telegram.
const recentFailureAlerts = new Map();
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

const shouldAlertFailure = (subject) => {
  const key = subject || 'unknown';
  const last = recentFailureAlerts.get(key) || 0;
  if (Date.now() - last < FAILURE_COOLDOWN_MS) return false;
  recentFailureAlerts.set(key, Date.now());
  return true;
};

// Sends an email and THROWS on failure. Callers that want fire-and-forget
// should attach `.catch(() => {})` explicitly. Silent-swallow was hiding
// warning-email failures from admins.
exports.sendEmail = async (to, subject, html) => {
  try {
    const response = await resend.emails.send({
      from: 'no-reply@shoplogshere.com', // must be verified in Resend
      to,
      subject,
      html,
    });
    // Resend returns { data: { id }, error } — an "error" field means the send failed
    // even though the HTTP call succeeded.
    if (response?.error) {
      throw new Error(response.error.message || 'Resend returned an error');
    }
    console.log(`✅ Email sent to ${to}`, response);
    return response;
  } catch (error) {
    console.error(`❌ Error sending email: ${error.message}`);
    if (shouldAlertFailure(subject)) {
      notify(
        `📮 <b>Email send failed</b>\n` +
          `To: ${escapeHtml(String(to))}\n` +
          `Subject: ${escapeHtml(String(subject || ''))}\n` +
          `Error: ${escapeHtml(error.message || 'unknown')}`,
        { severity: 'warn' }
      );
    }
    throw error;
  }
};
