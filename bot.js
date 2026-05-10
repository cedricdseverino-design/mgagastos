const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.TOKEN;
const SHEET_URL = process.env.SHEET_URL;

if (!TOKEN) {
  console.error('Missing TOKEN environment variable');
  process.exit(1);
}

if (!SHEET_URL) {
  console.error('Missing SHEET_URL environment variable');
  process.exit(1);
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

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

const editSessions = new Map();

function getDatePH() {
  return new Date().toLocaleDateString('en-PH');
}

function escapeMarkdown(text) {
  return String(text ?? '')
    .replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function parseAmount(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function formatMoney(amount) {
  const num = Number(amount || 0);
  return `₱${num.toLocaleString('en-PH', {
    minimumFractionDigits: num % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function buildEntryMessage(entry, totals) {
  const date = escapeMarkdown(entry.date);
  const category = escapeMarkdown(entry.category);
  const description = escapeMarkdown(entry.description || entry.category);
  const notes = escapeMarkdown(entry.notes || '—');
  const amount = escapeMarkdown(formatMoney(entry.amount));
  const type = escapeMarkdown(entry.type || 'Expense');

  let text =
    `✅ *Logged\\!*\n` +
    `📅 ${date}\n` +
    `🏷 ${category}\n` +
    `📝 ${description}\n` +
    `💰 ${amount}\n` +
    `📂 ${type}\n` +
    `💳 ${notes}`;

  if (totals) {
    const month = escapeMarkdown(totals.month || 'This month');
    const categoryTotal = escapeMarkdown(formatMoney(totals.categoryTotal || 0));
    const overallTotal = escapeMarkdown(formatMoney(totals.overallTotal || 0));

    text +=
      `\n\n📊 *${month} \u2014 ${category}*\n` +
      `Spent so far: *${categoryTotal}*`;

    // Show budget and remaining if available
    if (totals.categoryBudget !== null && totals.categoryBudget !== undefined) {
      const budget = escapeMarkdown(formatMoney(totals.categoryBudget));
      const remaining = totals.categoryRemaining;
      const remainingAmt = escapeMarkdown(formatMoney(Math.abs(remaining || 0)));

      text += `\nBudget: *${budget}*`;

      if (remaining !== null && remaining !== undefined) {
        if (remaining >= 0) {
          text += `\n🟢 Remaining: *${remainingAmt}*`;
        } else {
          text += `\n🔴 Over budget by: *${remainingAmt}*`;
        }
      }
    }

    text += `\n\n💼 *All expenses this month:* ${overallTotal}`;
  }

  return text;
}

function buildEditKeyboard(entryId) {
  return {
    inline_keyboard: [
      [
        { text: '✏️ Amount', callback_data: `edit:${entryId}:amount` },
        { text: '✏️ Notes', callback_data: `edit:${entryId}:notes` },
      ],
      [
        { text: '✏️ Category', callback_data: `edit:${entryId}:category` },
        { text: '🗑 Delete', callback_data: `delete:${entryId}` },
      ],
    ],
  };
}

function buildCancelKeyboard(entryId) {
  return {
    inline_keyboard: [
      [{ text: '❌ Cancel', callback_data: `cancel:${entryId}` }],
    ],
  };
}

async function fetchTotals(category) {
  const res = await axios.get(`${SHEET_URL}?category=${encodeURIComponent(category)}`);
  return res.data;
}

async function createEntry(payload) {
  const res = await axios.post(SHEET_URL, {
    action: 'create',
    ...payload,
  });
  return res.data;
}

async function updateEntry(entryId, field, value) {
  const res = await axios.post(SHEET_URL, {
    action: 'update',
    entryId,
    field,
    value,
  });
  return res.data;
}

async function deleteEntry(entryId) {
  const res = await axios.post(SHEET_URL, {
    action: 'delete',
    entryId,
  });
  return res.data;
}

function normalizeCategory(input) {
  const key = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return categoryMap[key] || null;
}

async function refreshEntryMessage(chatId, messageId, entry) {
  const totals = await fetchTotals(entry.category);
  await bot.editMessageText(buildEntryMessage(entry, totals), {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'MarkdownV2',
    reply_markup: buildEditKeyboard(entry.entryId),
  });
}

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data || '';

  try {
    const [action, entryId, field] = data.split(':');

    if (action === 'edit') {
      editSessions.set(chatId, {
        mode: 'edit',
        entryId,
        field,
        messageId,
      });

      let prompt = 'Send the new value.';
      if (field === 'amount') prompt = 'Send the new *amount* (example: `350`)';
      if (field === 'notes') prompt = 'Send the new *notes*';
      if (field === 'category') prompt = 'Send the new *category key* or category name';

      await bot.editMessageText(
        `✏️ Editing *${escapeMarkdown(field)}*\n\n${prompt}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'MarkdownV2',
          reply_markup: buildCancelKeyboard(entryId),
        }
      );

      await bot.answerCallbackQuery(query.id, { text: `Editing ${field}` });
      return;
    }

    if (action === 'cancel') {
      editSessions.delete(chatId);
      await bot.answerCallbackQuery(query.id, { text: 'Edit cancelled' });
      return;
    }

    if (action === 'delete') {
      const deleted = await deleteEntry(entryId);

      await bot.editMessageText('🗑 Entry deleted.', {
        chat_id: chatId,
        message_id: messageId,
      });

      await bot.answerCallbackQuery(query.id, {
        text: deleted?.message || 'Deleted',
      });
      return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
  } catch (err) {
    await bot.answerCallbackQuery(query.id, { text: 'Action failed' });
    await bot.sendMessage(chatId, '❌ Could not process that action.');
  }
});

bot.on('message', async (msg) => {
  const text = msg.text?.trim();
  if (!text) return;

  const chatId = msg.chat.id;

  if (text.startsWith('/')) return;

  const pendingEdit = editSessions.get(chatId);
  if (pendingEdit) {
    try {
      let newValue = text;

      if (pendingEdit.field === 'amount') {
        const amount = parseAmount(text);
        if (Number.isNaN(amount)) {
          return bot.sendMessage(chatId, '❌ Send a valid amount, like `350` or `125.50`.', {
            parse_mode: 'Markdown',
          });
        }
        newValue = amount;
      }

      if (pendingEdit.field === 'category') {
        const mapped = normalizeCategory(text);
        newValue = mapped || text.trim();
      }

      const result = await updateEntry(pendingEdit.entryId, pendingEdit.field, newValue);
      const entry = result.entry || {
        entryId: pendingEdit.entryId,
        date: result.date || getDatePH(),
        category: result.category || newValue,
        description: result.description || result.category || '',
        amount: result.amount || 0,
        type: result.type || 'Expense',
        notes: result.notes || '',
      };

      // Build totals from result if available, otherwise fetch
      const totals = (result.month) ? result : await fetchTotals(entry.category);

      await bot.editMessageText(buildEntryMessage(entry, totals), {
        chat_id: chatId,
        message_id: pendingEdit.messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: buildEditKeyboard(entry.entryId),
      });

      editSessions.delete(chatId);
      return bot.sendMessage(chatId, '✅ Entry updated.');
    } catch (err) {
      return bot.sendMessage(chatId, '❌ Failed to update entry.');
    }
  }

  const parts = text.split(' ');
  const categoryKey = parts[0].toLowerCase();
  const amount = parseAmount(parts[1]);
  const notes = parts.slice(2).join(' ') || '';
  const category = categoryMap[categoryKey];

  if (!category) {
    return bot.sendMessage(
      chatId,
      `❌ Unknown category: *${escapeMarkdown(parts[0])}*\n\nValid: ${Object.keys(categoryMap).join(', ')}`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  if (Number.isNaN(amount)) {
    return bot.sendMessage(chatId, '❌ Format: `food 500 bpi`', {
      parse_mode: 'Markdown',
    });
  }

  const date = getDatePH();

  try {
    const created = await createEntry({
      date,
      category,
      description: category,
      amount,
      type: 'Expense',
      notes,
      chatId,
    });

    const entryId = created.entryId || created.id || created.rowId;

    // Use totals returned directly from create response
    const totals = {
      month: created.month,
      categoryTotal: created.categoryTotal,
      overallTotal: created.overallTotal,
      categoryBudget: created.categoryBudget,
      categoryRemaining: created.categoryRemaining,
    };

    const sent = await bot.sendMessage(
      chatId,
      buildEntryMessage(
        {
          entryId,
          date,
          category,
          description: category,
          amount,
          type: 'Expense',
          notes,
        },
        totals
      ),
      {
        parse_mode: 'MarkdownV2',
        reply_markup: buildEditKeyboard(entryId),
      }
    );

    if (entryId) {
      try {
        await axios.post(SHEET_URL, {
          action: 'attachMessage',
          entryId,
          telegramChatId: chatId,
          telegramMessageId: sent.message_id,
        });
      } catch (e) {}
    }
  } catch (err) {
    bot.sendMessage(chatId, '❌ Failed to save. Try again.');
  }
});

bot.onText(/\/summary/, async (msg) => {
  try {
    const res = await axios.get(`${SHEET_URL}?category=all`);
    const totals = res.data;
    const cats = totals.allCategories || {};
    let breakdown = '';

    for (const [cat, amt] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
      breakdown += ` • ${cat}: ₱${Number(amt).toLocaleString()}\n`;
    }

    bot.sendMessage(
      msg.chat.id,
      `📊 *${totals.month} Summary*\n\n${breakdown}\n💼 *Total: ₱${Number(totals.overallTotal || 0).toLocaleString()}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Could not fetch summary.');
  }
});

bot.onText(/\/addcategory (.+)/, async (msg, match) => {
  const newCategory = match[1].trim();
  if (!newCategory) {
    return bot.sendMessage(msg.chat.id, '❌ Usage: `/addcategory Category Name`', {
      parse_mode: 'Markdown',
    });
  }

  try {
    await axios.post(SHEET_URL, { action: 'addCategory', category: newCategory });
    const key = newCategory.toLowerCase().replace(/[^a-z0-9]/g, '');
    categoryMap[key] = newCategory;

    bot.sendMessage(
      msg.chat.id,
      `✅ *Category added\!*\n🏷 *${escapeMarkdown(newCategory)}* has been added\.\n\nLog with: \`${key} amount\``,
      { parse_mode: 'MarkdownV2' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Failed to add category. Try again.');
  }
});

bot.onText(/\/categories/, async (msg) => {
  try {
    const res = await axios.get(`${SHEET_URL}?action=getCategories`);
    const categories = res.data.categories || Object.values(categoryMap);
    const unique = [...new Set(categories)].sort();

    bot.sendMessage(
      msg.chat.id,
      `📋 *Your Categories:*\n\n${unique.map(c => ` • ${c}`).join('\n')}\n\nAdd new: \`/addcategory Name\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    const unique = [...new Set(Object.values(categoryMap))].sort();
    bot.sendMessage(
      msg.chat.id,
      `📋 *Your Categories:*\n\n${unique.map(c => ` • ${c}`).join('\n')}\n\nAdd new: \`/addcategory Name\``,
      { parse_mode: 'Markdown' }
    );
  }
});

bot.onText(/\/start|\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `*Budget Tracker Bot* 💰\n\nFormat: \`category amount notes\`\n\nExamples:\n• \`food 500 bpi\`\n• \`coffee 150 gcash\`\n• \`gas 2000 bpi\`\n\nAfter logging, tap the inline buttons to edit the same entry\.\n\n/summary \u2014 monthly breakdown\n/categories \u2014 list all categories\n/addcategory Name \u2014 add a new category\n\nCategories: ${Object.keys(categoryMap).join(', ')}`,
    { parse_mode: 'MarkdownV2' }
  );
});

console.log('Budget bot running...');
