const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.TOKEN;
const SHEET_URL = process.env.SHEET_URL;

const bot = new TelegramBot(TOKEN, { polling: true });

const categoryMap = {
  food: 'Food & Dining',
  coffee: 'Coffee',
  transport: 'Transportation',
  transpo: 'Transportation',
  gas: 'Gas',
  gadgets: 'Gadgets',
  grocery: 'Groceries',
  groceries: 'Groceries',
  utilities: 'Utilities',
  bills: 'Utilities',
  rent: 'Housing / Rent',
  health: 'Healthcare',
  medicine: 'Healthcare',
  clothing: 'Clothing',
  clothes: 'Clothing',
  entertainment: 'Entertainment',
  invest: 'Investments',
  savings: 'Savings',
  ipon: 'Savings',
  education: 'Education',
  personal: 'Personal Care',
  subscriptions: 'Subscriptions',
  travel: 'Travel',
  misc: 'Miscellaneous',
};

bot.on('message', async (msg) => {
  const text = msg.text?.trim();
  if (!text || text.startsWith('/')) return;

  // Format: food 500 bpi
  const parts = text.split(' ');
  const categoryKey = parts[0].toLowerCase();
  const amount = parseFloat(parts[1]);
  const notes = parts.slice(2).join(' ') || '';

  const category = categoryMap[categoryKey];

  if (!category) {
    return bot.sendMessage(msg.chat.id,
      `❌ Unknown category: *${parts[0]}*\n\nValid: ${Object.keys(categoryMap).join(', ')}`,
      { parse_mode: 'Markdown' }
    );
  }

  if (isNaN(amount)) {
    return bot.sendMessage(msg.chat.id,
      '❌ Format: `food 500 bpi`',
      { parse_mode: 'Markdown' }
    );
  }

  const date = new Date().toLocaleDateString('en-PH');

  try {
    // 1. Log the entry to the sheet
    await axios.post(SHEET_URL, {
      date, category, description: category,
      amount, type: 'Expense', notes
    });

    // 2. Fetch monthly totals for this category
    const res = await axios.get(`${SHEET_URL}?category=${encodeURIComponent(category)}`);
    const totals = res.data;

    // 3. Reply with confirmation + monthly summary
    bot.sendMessage(msg.chat.id,
      `✅ *Logged!*\n` +
      `📅 ${date}\n` +
      `🏷 ${category}\n` +
      `💰 ₱${amount.toLocaleString()}\n` +
      `💳 ${notes || '—'}\n\n` +
      `📊 *${totals.month} — ${category}*\n` +
      `Total so far: *₱${totals.categoryTotal.toLocaleString()}*\n\n` +
      `💼 *All expenses this month:* ₱${totals.overallTotal.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Failed to save. Try again.');
  }
});

bot.onText(/\/summary/, async (msg) => {
  try {
    const res = await axios.get(`${SHEET_URL}?category=all`);
    const totals = res.data;
    const cats = totals.allCategories;

    let breakdown = '';
    for (const [cat, amt] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
      breakdown += `  • ${cat}: ₱${amt.toLocaleString()}\n`;
    }

    bot.sendMessage(msg.chat.id,
      `📊 *${totals.month} Summary*\n\n` +
      `${breakdown}\n` +
      `💼 *Total: ₱${totals.overallTotal.toLocaleString()}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Could not fetch summary.');
  }
});

bot.onText(/\/start|\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `*Budget Tracker Bot* 💰\n\nFormat: \`category amount payment\`\n\nExamples:\n• \`food 500 bpi\`\n• \`coffee 150 gcash\`\n• \`gas 2000 bpi\`\n\n/summary — see full monthly breakdown\n\nCategories: ${Object.keys(categoryMap).join(', ')}`,
    { parse_mode: 'Markdown' }
  );
});

console.log('Budget bot running...');
