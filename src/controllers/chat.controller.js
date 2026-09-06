const Product = require('../models/Product.model');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const MAX_HISTORY = 20;
const MAX_USER_MESSAGE_LENGTH = 2000;
const PRODUCT_CONTEXT_LIMIT = 40;

const buildProductContext = async () => {
  const products = await Product.find({ isActive: true })
    .select('name description price quantity category featured')
    .sort({ featured: -1, updatedAt: -1 })
    .limit(PRODUCT_CONTEXT_LIMIT)
    .lean();

  if (!products.length) return 'No products currently listed.';

  return products
    .map((p) => {
      const stock = p.quantity > 0 ? `${p.quantity} in stock` : 'out of stock';
      const featured = p.featured ? ' [featured]' : '';
      return `- ${p.name} (${p.category}) — $${Number(p.price).toFixed(2)}, ${stock}${featured}. ${p.description}`;
    })
    .join('\n');
};

const buildSystemPrompt = (productCatalog, user) => {
  const greeting = user?.name
    ? `The signed-in shopper's name is ${user.name}.`
    : 'The shopper is browsing as a guest.';

  return `You are ShopBot, the shopping assistant for ShopLogs — an online marketplace that sells logs and related products.

Your job is to help shoppers:
- Discover products from the catalog below
- Answer questions about pricing, stock, categories, and product details
- Guide them through browsing, adding to cart, and checking out
- Answer FAQs (shipping, returns, wallet, orders)

Style guide:
- Be concise, warm, and helpful. 2-4 short sentences per reply unless the shopper asks for detail.
- When recommending products, mention the exact name and price so the shopper can find them in the store.
- If a product is out of stock, say so and suggest alternatives from the catalog.
- If the shopper asks about something not in the catalog, say you don't currently carry it and suggest the closest match.
- Never invent products, prices, or policies. If unsure, tell the shopper to check the product page or contact support.

${greeting}

Current catalog (top ${PRODUCT_CONTEXT_LIMIT} active products, newest/featured first):
${productCatalog}

Shop policies (defaults — mention these only if asked):
- Payment: wallet balance on the site
- Orders can be viewed under /orders after signing in
- For account or payment issues, direct the shopper to support`;
};

exports.chat = async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'messages must be a non-empty array of { role, content }',
      });
    }

    const sanitized = messages
      .slice(-MAX_HISTORY)
      .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role))
      .map((m) => ({
        role: m.role,
        content: m.content.slice(0, MAX_USER_MESSAGE_LENGTH),
      }));

    if (sanitized.length === 0 || sanitized[sanitized.length - 1].role !== 'user') {
      return res.status(400).json({
        success: false,
        message: 'The last message must be from the user',
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Chat service is not configured (missing GROQ_API_KEY)',
      });
    }

    const productCatalog = await buildProductContext();
    const systemPrompt = buildSystemPrompt(productCatalog, req.user);

    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.4,
        max_tokens: 500,
        messages: [{ role: 'system', content: systemPrompt }, ...sanitized],
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('Groq API error:', groqRes.status, errText);
      return res.status(502).json({
        success: false,
        message: 'Chat service is temporarily unavailable',
      });
    }

    const data = await groqRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(502).json({
        success: false,
        message: 'No response from chat service',
      });
    }

    res.json({
      success: true,
      data: {
        message: { role: 'assistant', content: reply },
      },
    });
  } catch (error) {
    console.error('Chat controller error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing chat request',
      error: error.message,
    });
  }
};
