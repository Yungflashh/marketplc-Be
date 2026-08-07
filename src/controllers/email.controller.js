const EmailCampaign = require('../models/EmailCampaign.model');
const User = require('../models/User.model');
const Order = require('../models/Order.model');
const { sendEmail } = require('../utils/email');
const { renderEmailHtml, renderPreview } = require('../utils/emailRenderer');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const RECIPIENT_PREVIEW_LIMIT = 20;
const MAX_RECIPIENTS_PER_SEND = 500;

const TEMPLATE_GUIDES = {
  newsletter:
    'Warm, informative newsletter tone. Include a short intro, 2-3 highlights as bullet-style paragraphs, and a friendly sign-off.',
  promo:
    'Punchy promotional tone. Clear value proposition, urgency (deadline or stock hint), and a single obvious call-to-action.',
  announcement:
    'Direct, professional announcement. Lead with the news, then context, then what the reader should do next.',
  restock:
    'Excited restock notification. Name the product(s) and category, mention limited availability, invite the shopper to view the store.',
  'thank-you':
    'Warm, personal thank-you tone. Acknowledge the recent purchase, express appreciation, invite them back with a soft nudge.',
  reengagement:
    'Friendly re-engagement tone. Notice their absence gently, remind them what they liked, invite them back without being pushy.',
  custom: 'Match the tone the admin describes in their prompt.',
};

const buildFilterQuery = (recipients = {}) => {
  const query = {};
  const filters = recipients.filters || {};
  if (filters.role) query.role = filters.role;
  if (typeof filters.isVerified === 'boolean') query.isVerified = filters.isVerified;
  if (typeof filters.isActive === 'boolean') query.isActive = filters.isActive;
  return query;
};

const findUserIdsWithOrdersSince = async (sinceDate) => {
  const ids = await Order.distinct('user', { createdAt: { $gte: sinceDate } });
  return ids;
};

const applyOrderFilters = async (baseQuery, filters = {}) => {
  const query = { ...baseQuery };
  const now = Date.now();

  if (filters.hasOrderedInLastDays > 0) {
    const since = new Date(now - filters.hasOrderedInLastDays * 86400000);
    const ids = await findUserIdsWithOrdersSince(since);
    query._id = query._id ? { $and: [query._id, { $in: ids }] } : { $in: ids };
  }
  if (filters.hasNotOrderedInLastDays > 0) {
    const since = new Date(now - filters.hasNotOrderedInLastDays * 86400000);
    const excludeIds = await findUserIdsWithOrdersSince(since);
    query._id = query._id ? { $and: [query._id, { $nin: excludeIds }] } : { $nin: excludeIds };
  }
  return query;
};

const resolveRecipients = async (recipients) => {
  if (!recipients || !recipients.type) return [];

  if (recipients.type === 'external') {
    return (recipients.externalEmails || [])
      .map((e) => (e || '').trim().toLowerCase())
      .filter(Boolean)
      .map((email) => ({ email, name: '' }));
  }

  if (recipients.type === 'individual') {
    const users = await User.find({ _id: { $in: recipients.userIds || [] } })
      .select('name email')
      .lean();
    return users.map((u) => ({ email: u.email, name: u.name }));
  }

  if (recipients.type === 'all') {
    const users = await User.find({ isActive: true }).select('name email').lean();
    return users.map((u) => ({ email: u.email, name: u.name }));
  }

  if (recipients.type === 'segment') {
    let query = buildFilterQuery(recipients);
    query = await applyOrderFilters(query, recipients.filters || {});
    const users = await User.find(query).select('name email').lean();
    return users.map((u) => ({ email: u.email, name: u.name }));
  }

  return [];
};

exports.previewRecipients = async (req, res) => {
  try {
    const { recipients } = req.body;
    const list = await resolveRecipients(recipients);
    res.json({
      success: true,
      data: {
        total: list.length,
        sample: list.slice(0, RECIPIENT_PREVIEW_LIMIT),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error resolving recipients',
      error: error.message,
    });
  }
};

exports.searchUsers = async (req, res) => {
  try {
    const { q = '' } = req.query;
    const query = q
      ? {
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } },
          ],
        }
      : {};
    const users = await User.find(query).select('name email role').limit(25).lean();
    res.json({ success: true, data: { users } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error searching users',
      error: error.message,
    });
  }
};

exports.generateDraft = async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'AI drafting is not configured (missing GROQ_API_KEY)',
      });
    }

    const { prompt, template = 'custom', audienceHint } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ success: false, message: 'prompt is required' });
    }

    const templateGuide = TEMPLATE_GUIDES[template] || TEMPLATE_GUIDES.custom;

    const systemPrompt = `You draft transactional and marketing emails for ShopLogs, an online marketplace that sells logs.

Guidelines:
- Style: ${templateGuide}
- Keep the body under 200 words unless the admin asks for more.
- Return valid JSON only, matching this schema exactly:
  {"subject": string, "body": string}
- The body must be HTML fragment (no <html>, <head>, or <body> tags). Use <p>, <strong>, <a>, <ul>, <li>, and <br> only. Do not include images.
- When adding a call-to-action, wrap it as: <a href="https://shoplogshere.com" class="cta">Button Text</a>
- Personalize with {{name}} where a first name would fit — the sender will replace it per recipient. If the audience is external/unknown, omit {{name}}.
- Never invent prices, promo codes, or dates. If the admin's prompt lacks specifics, keep the copy generic.
- End with a short sign-off "— The ShopLogs Team".

Audience note: ${audienceHint || 'general shoppers'}.`;

    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.6,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt.slice(0, 2000) },
        ],
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('Groq draft error:', groqRes.status, errText);
      return res.status(502).json({
        success: false,
        message: 'AI drafting is temporarily unavailable',
      });
    }

    const data = await groqRes.json();
    const raw = data?.choices?.[0]?.message?.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ success: false, message: 'AI returned an invalid draft' });
    }
    if (!parsed?.subject || !parsed?.body) {
      return res.status(502).json({ success: false, message: 'AI draft is missing subject or body' });
    }

    res.json({
      success: true,
      data: { draft: { subject: parsed.subject, body: parsed.body } },
    });
  } catch (error) {
    console.error('generateDraft error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating draft',
      error: error.message,
    });
  }
};

exports.previewHtml = async (req, res) => {
  try {
    const { body, design, name } = req.body;
    const html = renderPreview(body || '', design || {}, name || 'there');
    res.json({ success: true, data: { html } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error rendering preview',
      error: error.message,
    });
  }
};

exports.listCampaigns = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [campaigns, total] = await Promise.all([
      EmailCampaign.find(filter)
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      EmailCampaign.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        campaigns,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error listing campaigns',
      error: error.message,
    });
  }
};

exports.getCampaign = async (req, res) => {
  try {
    const campaign = await EmailCampaign.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('recipients.userIds', 'name email')
      .lean();
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    res.json({ success: true, data: { campaign } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching campaign',
      error: error.message,
    });
  }
};

exports.createCampaign = async (req, res) => {
  try {
    const { subject, body, recipients, aiPrompt, template, design } = req.body;
    if (!subject || !body || !recipients?.type) {
      return res.status(400).json({
        success: false,
        message: 'subject, body, and recipients.type are required',
      });
    }
    const campaign = await EmailCampaign.create({
      subject,
      body,
      recipients,
      aiPrompt,
      template: template || 'custom',
      design: design || undefined,
      status: 'draft',
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: { campaign } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating campaign',
      error: error.message,
    });
  }
};

exports.updateCampaign = async (req, res) => {
  try {
    const campaign = await EmailCampaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    if (campaign.status === 'sent') {
      return res.status(400).json({
        success: false,
        message: 'Sent campaigns cannot be edited',
      });
    }
    const { subject, body, recipients, aiPrompt, template, design } = req.body;
    if (subject !== undefined) campaign.subject = subject;
    if (body !== undefined) campaign.body = body;
    if (recipients !== undefined) campaign.recipients = recipients;
    if (aiPrompt !== undefined) campaign.aiPrompt = aiPrompt;
    if (template !== undefined) campaign.template = template;
    if (design !== undefined) campaign.design = design;
    await campaign.save();
    res.json({ success: true, data: { campaign } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating campaign',
      error: error.message,
    });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const campaign = await EmailCampaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    await campaign.deleteOne();
    res.json({ success: true, message: 'Campaign deleted' });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting campaign',
      error: error.message,
    });
  }
};

const personalize = (text, name) => {
  if (!text) return text;
  const safeName = (name || '').split(' ')[0] || 'there';
  return text.replaceAll('{{name}}', safeName);
};

exports.sendCampaign = async (req, res) => {
  try {
    const campaign = await EmailCampaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    if (campaign.status === 'sent') {
      return res.status(400).json({
        success: false,
        message: 'Campaign has already been sent',
      });
    }

    const recipientList = await resolveRecipients(campaign.recipients);
    if (recipientList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No recipients resolved for this campaign',
      });
    }
    if (recipientList.length > MAX_RECIPIENTS_PER_SEND) {
      return res.status(400).json({
        success: false,
        message: `Recipient count (${recipientList.length}) exceeds max of ${MAX_RECIPIENTS_PER_SEND}`,
      });
    }

    const design = (campaign.design && campaign.design.toObject?.()) || campaign.design || {};
    const details = [];
    let succeeded = 0;
    let failed = 0;

    for (const { email, name } of recipientList) {
      try {
        const personalizedBody = personalize(campaign.body, name);
        const personalizedSubject = personalize(campaign.subject, name);
        const html = renderEmailHtml(personalizedBody, design);
        await sendEmail(email, personalizedSubject, html);
        succeeded += 1;
        details.push({ email, status: 'sent' });
      } catch (err) {
        failed += 1;
        details.push({ email, status: 'failed', error: err.message });
      }
    }

    campaign.status = failed > 0 && succeeded === 0 ? 'failed' : 'sent';
    campaign.sentAt = new Date();
    campaign.sendResults = { total: recipientList.length, succeeded, failed, details };
    await campaign.save();

    res.json({
      success: true,
      message: `Campaign sent to ${succeeded} of ${recipientList.length} recipients`,
      data: { campaign },
    });
  } catch (error) {
    console.error('sendCampaign error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending campaign',
      error: error.message,
    });
  }
};

// -----------------------------------------------------------
// Default seed templates
// -----------------------------------------------------------

const DEFAULT_TEMPLATES = [
  {
    defaultKey: 'thank-you-recent-buyers',
    subject: 'Thanks for your recent order, {{name}} 💛',
    template: 'thank-you',
    design: {
      accentColor: '#0f766e',
      backgroundColor: '#f0fdfa',
      textColor: '#134e4a',
      headerText: 'ShopLogs',
      layout: 'branded',
    },
    recipients: {
      type: 'segment',
      filters: { isActive: true, hasOrderedInLastDays: 7 },
    },
    body: `<p>Hi {{name}},</p>
<p>Just a quick note to say <strong>thank you</strong> for your recent order with us. We really appreciate you choosing ShopLogs.</p>
<p>Your logs are on their way and should be with you soon. If anything comes up, hit reply — a real human is on the other end.</p>
<p>Curious what's new? Come see what's just landed.</p>
<p><a href="https://shoplogshere.com/store" class="cta">Browse the store</a></p>
<p>— The ShopLogs Team</p>`,
  },
  {
    defaultKey: 'reengagement-dormant',
    subject: 'We saved your spot, {{name}} 👋',
    template: 'reengagement',
    design: {
      accentColor: '#b45309',
      backgroundColor: '#fffbeb',
      textColor: '#78350f',
      headerText: 'ShopLogs',
      layout: 'branded',
    },
    recipients: {
      type: 'segment',
      filters: { isActive: true, hasNotOrderedInLastDays: 30 },
    },
    body: `<p>Hi {{name}},</p>
<p>It's been a little while since we last saw you and honestly? We miss you.</p>
<p>A lot has changed since your last visit — fresh logs, new categories, and a few surprises we think you'll love.</p>
<p>No pressure. Just come take a peek.</p>
<p><a href="https://shoplogshere.com/store" class="cta">See what's new</a></p>
<p>— The ShopLogs Team</p>`,
  },
  {
    defaultKey: 'newsletter-monthly',
    subject: 'What\'s new at ShopLogs this month',
    template: 'newsletter',
    design: {
      accentColor: '#1e40af',
      backgroundColor: '#eff6ff',
      textColor: '#1e3a8a',
      headerText: 'ShopLogs',
      layout: 'branded',
    },
    recipients: {
      type: 'segment',
      filters: { isActive: true, isVerified: true },
    },
    body: `<p>Hi {{name}},</p>
<p>Here's a quick roundup of what's happening in the shop this month.</p>
<ul>
  <li><strong>New arrivals</strong> — fresh logs added across several categories.</li>
  <li><strong>Restocks</strong> — a few of your favorites are back in stock.</li>
  <li><strong>Community</strong> — thousands of you shopped with us this month. Thank you.</li>
</ul>
<p><a href="https://shoplogshere.com/store" class="cta">Visit the store</a></p>
<p>— The ShopLogs Team</p>`,
  },
];

exports.seedDefaults = async (req, res) => {
  try {
    const created = [];
    const skipped = [];

    for (const tpl of DEFAULT_TEMPLATES) {
      const existing = await EmailCampaign.findOne({ defaultKey: tpl.defaultKey });
      if (existing) {
        skipped.push(tpl.defaultKey);
        continue;
      }
      const campaign = await EmailCampaign.create({
        ...tpl,
        status: 'draft',
        isDefault: true,
        createdBy: req.user._id,
      });
      created.push(campaign);
    }

    res.json({
      success: true,
      message: `Seeded ${created.length} template${created.length === 1 ? '' : 's'} (${skipped.length} already existed)`,
      data: { created, skipped },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error seeding defaults',
      error: error.message,
    });
  }
};

// -----------------------------------------------------------
// AI Suggestions
// -----------------------------------------------------------

exports.suggestions = async (req, res) => {
  try {
    const now = Date.now();
    const day = 86400000;

    const [totalUsers, verifiedUsers, recentBuyerIds, thirtyDayBuyerIds, draftCampaigns] =
      await Promise.all([
        User.countDocuments({ isActive: true }),
        User.countDocuments({ isActive: true, isVerified: true }),
        findUserIdsWithOrdersSince(new Date(now - 7 * day)),
        findUserIdsWithOrdersSince(new Date(now - 30 * day)),
        EmailCampaign.find({ status: 'draft' }).select('defaultKey template subject').lean(),
      ]);

    const dormantCount = Math.max(0, totalUsers - thirtyDayBuyerIds.length);
    const draftKeys = new Set(draftCampaigns.map((c) => c.defaultKey).filter(Boolean));

    const built = [];

    if (recentBuyerIds.length > 0) {
      built.push({
        id: 'thank-recent-buyers',
        icon: 'heart',
        title: `Thank ${recentBuyerIds.length} recent buyer${recentBuyerIds.length === 1 ? '' : 's'}`,
        reason: `Users who ordered in the last 7 days would love a quick thank-you note.`,
        action: {
          kind: 'seed-if-missing',
          defaultKey: 'thank-you-recent-buyers',
          alreadyExists: draftKeys.has('thank-you-recent-buyers'),
        },
      });
    }

    if (dormantCount > 0) {
      built.push({
        id: 'reengage-dormant',
        icon: 'user-x',
        title: `Re-engage ${dormantCount} dormant user${dormantCount === 1 ? '' : 's'}`,
        reason: `${dormantCount} users haven't ordered in 30+ days. A friendly nudge could bring them back.`,
        action: {
          kind: 'seed-if-missing',
          defaultKey: 'reengagement-dormant',
          alreadyExists: draftKeys.has('reengagement-dormant'),
        },
      });
    }

    if (verifiedUsers >= 5) {
      built.push({
        id: 'monthly-newsletter',
        icon: 'newspaper',
        title: 'Send a monthly newsletter',
        reason: `You have ${verifiedUsers} verified users. A monthly update keeps them engaged.`,
        action: {
          kind: 'seed-if-missing',
          defaultKey: 'newsletter-monthly',
          alreadyExists: draftKeys.has('newsletter-monthly'),
        },
      });
    }

    let aiInsight = null;
    if (process.env.GROQ_API_KEY) {
      try {
        const groqRes = await fetch(GROQ_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            temperature: 0.5,
            max_tokens: 200,
            messages: [
              {
                role: 'system',
                content:
                  'You are an email marketing advisor for a small ecommerce shop selling logs. Given the stats, give ONE short, specific, actionable email suggestion the admin should consider this week. 1-2 sentences max. Do not repeat obvious things like "send a welcome email."',
              },
              {
                role: 'user',
                content: `Stats: ${totalUsers} active users, ${verifiedUsers} verified, ${recentBuyerIds.length} bought in last 7 days, ${dormantCount} dormant (no order in 30 days).`,
              },
            ],
          }),
        });
        if (groqRes.ok) {
          const data = await groqRes.json();
          aiInsight = data?.choices?.[0]?.message?.content?.trim() || null;
        }
      } catch (err) {
        console.warn('AI insight error:', err.message);
      }
    }

    res.json({
      success: true,
      data: {
        suggestions: built,
        aiInsight,
        stats: {
          totalUsers,
          verifiedUsers,
          recentBuyers: recentBuyerIds.length,
          dormantUsers: dormantCount,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating suggestions',
      error: error.message,
    });
  }
};

exports.actOnSuggestion = async (req, res) => {
  try {
    const { defaultKey } = req.body;
    const tpl = DEFAULT_TEMPLATES.find((t) => t.defaultKey === defaultKey);
    if (!tpl) {
      return res.status(400).json({ success: false, message: 'Unknown default template' });
    }
    let campaign = await EmailCampaign.findOne({ defaultKey });
    if (!campaign) {
      campaign = await EmailCampaign.create({
        ...tpl,
        status: 'draft',
        isDefault: true,
        createdBy: req.user._id,
      });
    }
    res.json({ success: true, data: { campaign } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error acting on suggestion',
      error: error.message,
    });
  }
};
