const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = '8107751612:AAGOJM1_Yjb1-MjQ68S-QIMOziBMWn9fjmk';
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbzbsIj6FuH5H7QGfBAGAIIQjEUyAaaDVfR8jPxK45pCjfgKKtWgCjGal1hUnl67x1UPRg/exec';

const bot = new TelegramBot(TOKEN, { polling: true });

const categoryMap = {
  food: 'Food & Dining',
  coffee: 'Coffee',
  transport: 'Transportation',
  transpo: 'Transportation',
  gas: 'Transportation',
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

  const parts = text.split(' ');
  const categoryKey = parts[0].toLowerCase();
  const amount = parseFloat(parts[1]);
  const notes = parts.slice(2).join(' ') || '';

  const category = categoryMap[categoryKey];

  if (!category) {
    return bot.sendMessage(msg.chat.id,
      `❌ Unknown category: *${parts[0]}*\n\nValid categories:\n${Object.keys(categoryMap).join(', ')}`,
      { parse_mode: 'Markdown' }
    );
  }

  if (isNaN(amount)) {
    return bot.sendMessage(msg.chat.id,
      '❌ Format: `food 500 bpi`\n_(category amount payment)_',
      { parse_mode: 'Markdown' }
    );
  }

  const date = new Date().toLocaleDateString('en-PH');

  try {
    await axios.post(SHEET_URL, {
      date, category, description: category,
      amount, type: 'Expense', notes
    });

    bot.sendMessage(msg.chat.id,
      `✅ *Logged!*\n📅 ${date}\n🏷 ${category}\n💰 ₱${amount.toLocaleString()}\n💳 ${notes || '—'}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Failed to save. Try again.');
  }
});

bot.onText(/\/start|\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `*Budget Tracker Bot* 💰\n\nFormat: \`category amount payment\`\n\nExamples:\n• \`food 500 bpi\`\n• \`transpo 50 cash\`\n• \`grocery 1200 gcash\`\n\nCategories:\n${Object.keys(categoryMap).join(', ')}`,
    { parse_mode: 'Markdown' }
  );
});

console.log('Budget bot is running...');