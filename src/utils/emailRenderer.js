const DEFAULTS = {
  accentColor: '#111827',
  backgroundColor: '#f9fafb',
  textColor: '#374151',
  headerText: 'ShopLogs',
  layout: 'branded',
};

const escapeAttr = (s) => String(s || '').replace(/"/g, '&quot;');

const commonStyles = (d) => `
  body { margin: 0; padding: 0; background: ${d.backgroundColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: ${d.textColor}; }
  a { color: ${d.accentColor}; text-decoration: none; }
  .container { max-width: 600px; margin: 0 auto; }
  .card { background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .header { padding: 24px 32px; }
  .body { padding: 32px; font-size: 15px; line-height: 1.65; }
  .body p { margin: 0 0 14px; }
  .body h1, .body h2, .body h3 { color: #111827; margin: 24px 0 12px; }
  .body ul { padding-left: 20px; margin: 0 0 14px; }
  .cta { display: inline-block; background: ${d.accentColor}; color: #ffffff !important; padding: 12px 24px; border-radius: 8px; font-weight: 600; margin: 8px 0; }
  .footer { padding: 24px 32px; font-size: 12px; color: #9ca3af; text-align: center; }
  .footer a { color: #6b7280; }
`;

const brandedShell = (body, d) => `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeAttr(d.headerText)}</title>
  <style>${commonStyles(d)}
    .header { background: ${d.accentColor}; color: #ffffff; text-align: left; }
    .brand { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
  </style>
</head>
<body>
  <div style="padding: 32px 16px;">
    <div class="container">
      <div class="card">
        <div class="header">
          <div class="brand">${escapeAttr(d.headerText)}</div>
        </div>
        <div class="body">${body}</div>
      </div>
      <div class="footer">
        You're receiving this from ${escapeAttr(d.headerText)}. <br>
        © ${new Date().getFullYear()} ${escapeAttr(d.headerText)}. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>`;

const simpleShell = (body, d) => `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeAttr(d.headerText)}</title>
  <style>${commonStyles(d)}
    .header { border-bottom: 2px solid ${d.accentColor}; }
    .brand { font-size: 18px; font-weight: 700; color: ${d.accentColor}; }
  </style>
</head>
<body>
  <div style="padding: 32px 16px;">
    <div class="container">
      <div class="card">
        <div class="header">
          <div class="brand">${escapeAttr(d.headerText)}</div>
        </div>
        <div class="body">${body}</div>
      </div>
      <div class="footer">
        © ${new Date().getFullYear()} ${escapeAttr(d.headerText)}
      </div>
    </div>
  </div>
</body>
</html>`;

const minimalShell = (body, d) => `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeAttr(d.headerText)}</title>
  <style>${commonStyles(d)}
    .card { box-shadow: none; background: transparent; }
    .body { padding: 24px 0; }
  </style>
</head>
<body>
  <div style="padding: 32px 16px;">
    <div class="container">
      <div class="body">${body}</div>
      <div class="footer">
        — ${escapeAttr(d.headerText)}
      </div>
    </div>
  </div>
</body>
</html>`;

exports.renderEmailHtml = (body, design = {}) => {
  const d = { ...DEFAULTS, ...design };
  const safeBody = body || '';
  if (d.layout === 'simple') return simpleShell(safeBody, d);
  if (d.layout === 'minimal') return minimalShell(safeBody, d);
  return brandedShell(safeBody, d);
};

exports.renderPreview = (body, design = {}, personalized = 'there') => {
  const substituted = (body || '').replaceAll('{{name}}', personalized);
  return exports.renderEmailHtml(substituted, design);
};
