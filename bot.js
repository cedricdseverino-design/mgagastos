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
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function parseAmount(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value || '').replace(/,/g, '').trim();
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
  const date = escapeMarkdown(entry.date || getDatePH());
  const category = escapeMarkdown(entry.category || 'Uncategorized');
  const description = escapeMarkdown(entry.description || entry.category || '—');
  const notes = escapeMarkdown(entry.notes || '—');
  const amount = escapeMarkdown(formatMoney(entry.amount || 0));
  const type = escapeMarkdown(entry.type || 'Expense');

  let text =
    `✅ *Logged\\!*\n` +
    `📅 ${date}\n` +
    `🏷 ${category}\n` +
    `📝 ${description}\n` +
    `💰 ${amount}\n` +
    `📂 ${type}\n` +
    `💳 ${notes}`;

  if (totals && typeof totals === 'object') {
    const month = escapeMarkdown(totals.month || 'This month');
    const categoryTotal = escapeMarkdown(formatMoney(totals.categoryTotal || 0));
    const overallTotal = escapeMarkdown(formatMoney(totals.overallTotal || 0));
    text +=
      `\n\n📊 *${month} — ${category}*\n` +
      `Total so far: *${categoryTotal}*\n\n` +
      `💼 *All expenses this month:* ${overallTotal}`;
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

async function safeGet(url) {
  const res = await axios.get(url);
  return res.data;
}

async function safePost(payload) {
  const res = await axios.post(SHEET_URL, payload);
  return res.data;
}

async function fetchTotals(category) {
  try {
    return await safeGet(`${SHEET_URL}?category=${encodeURIComponent(category)}`);
  } catch (err) {
    console.error('Fetch totals error:', err?.response?.data || err.message || err);
    return null;
  }
}

async function createEntry(payload) {
  return await safePost({
    action: 'create',
    ...payload,
  });
}

async function updateEntry(entryId, field, value) {
  return await safePost({
    action: 'update',
    entryId,
    field,
    value,
  });
}

async function deleteEntry(entryId) {
  return await safePost({
    action: 'delete',
    entryId,
  });
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
        entryId,
        field,
        messageId,
      });

      let prompt = 'Send the new value.';
      if (field === 'amount') prompt = 'Send the new amount (example: 350)';
      if (field === 'notes') prompt = 'Send the new notes';
      if (field === 'category') prompt = 'Send the new category key or category name';

      await bot.editMessageText(`✏️ Editing ${field}\n\n${prompt}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: buildCancelKeyboard(entryId),
      });

      await bot.answerCallbackQuery(query.id, { text: `Editing ${field}` });
      return;
    }

    if (action === 'cancel') {
      editSessions.delete(chatId);
      await bot.answerCallbackQuery(query.id, { text: 'Edit cancelled' });
      return;
    }

    if (action === 'delete') {
      await deleteEntry(entryId);

      await bot.editMessageText('🗑 Entry deleted.', {
        chat_id: chatId,
        message_id: messageId,
      });

      await bot.answerCallbackQuery(query.id, { text: 'Deleted' });
      return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
  } catch (err) {
    console.error('Callback query error:', err?.response?.data || err.message || err);
    try {
      await bot.answerCallbackQuery(query.id, { text: 'Action failed' });
    } catch (e) {
      console.error('answerCallbackQuery error:', e?.response?.data || e.message || e);
    }
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
          return bot.sendMessage(chatId, '❌ Send a valid amount, like 350 or 125.50.');
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
        category: result.category || 'Uncategorized',
        description: result.description || result.category || '—',
        amount: result.amount || 0,
        type: result.type || 'Expense',
        notes: result.notes || '',
      };

      await refreshEntryMessage(chatId, pendingEdit.messageId, entry);
      editSessions.delete(chatId);

      return bot.sendMessage(chatId, '✅ Entry updated.');
    } catch (err) {
      console.error('Update error:', err?.response?.data || err.message || err);
      return bot.sendMessage(chatId, '❌ Failed to update entry.');
    }
  }

  const parts = text.split(' ');
  const categoryKey = (parts[0] || '').toLowerCase();
  const amount = parseAmount(parts[1]);
  const notes = parts.slice(2).join(' ') || '';
  const category = categoryMap[categoryKey];

  if (!category) {
    return bot.sendMessage(
      chatId,
      `❌ Unknown category: *${escapeMarkdown(parts[0] || '')}*\n\nValid: ${Object.keys(categoryMap).join(', ')}`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  if (Number.isNaN(amount)) {
    return bot.sendMessage(chatId, '❌ Format: food 500 bpi');
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

    const entryId = created.entryId || created.id || created.rowId || created.entry_id;
    if (!entryId) {
      console.error('Create response missing entryId:', created);
      return bot.sendMessage(chatId, '❌ Saved data is missing entry ID. Check backend.');
    }

    const totals = await fetchTotals(category);

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

    try {
      await safePost({
        action: 'attachMessage',
        entryId,
        telegramChatId: chatId,
        telegramMessageId: sent.message_id,
      });
    } catch (e) {
      console.error('Attach message error:', e?.response?.data || e.message || e);
    }
  } catch (err) {
    console.error('Create error:', err?.response?.data || err.message || err);
    bot.sendMessage(chatId, '❌ Failed to save. Try again.');
  }
});

bot.onText(/\/summary/, async (msg) => {
  try {
    const totals = await safeGet(`${SHEET_URL}?category=all`);
    const cats = totals.allCategories || {};
    let breakdown = '';

    for (const [cat, amt] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
      breakdown += ` • ${cat}: ₱${Number(amt).toLocaleString()}\n`;
    }

    bot.sendMessage(
      msg.chat.id,
      `📊 *${totals.month || 'Monthly'} Summary*\n\n${breakdown}\n💼 *Total: ₱${Number(totals.overallTotal || 0).toLocaleString()}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Summary error:', err?.response?.data || err.message || err);
    bot.sendMessage(msg.chat.id, '❌ Could not fetch summary.');
  }
});

bot.onText(/\/addcategory (.+)/, async (msg, match) => {
  const newCategory = match[1].trim();
  if (!newCategory) {
    return bot.sendMessage(msg.chat.id, '❌ Usage: /addcategory Category Name');
  }

  try {
    await safePost({ action: 'addCategory', category: newCategory });
    const key = newCategory.toLowerCase().replace(/[^a-z0-9]/g, '');
    categoryMap[key] = newCategory;

    bot.sendMessage(
      msg.chat.id,
      `✅ Category added!\n🏷 ${newCategory} has been added.\n\nYou can now log expenses with: ${key} amount`
    );
  } catch (err) {
    console.error('Add category error:', err?.response?.data || err.message || err);
    bot.sendMessage(msg.chat.id, '❌ Failed to add category. Try again.');
  }
});

bot.onText(/\/categories/, async (msg) => {
  try {
    const res = await safeGet(`${SHEET_URL}?action=getCategories`);
    const categories = res.categories || Object.values(categoryMap);
    const unique = [...new Set(categories)].sort();

    bot.sendMessage(
      msg.chat.id,
      `📋 Your Categories:\n\n${unique.map(c => ` • ${c}`).join('\n')}\n\nAdd new: /addcategory Name`
    );
  } catch (err) {
    console.error('Categories error:', err?.response?.data || err.message || err);
    const unique = [...new Set(Object.values(categoryMap))].sort();
    bot.sendMessage(
      msg.chat.id,
      `📋 Your Categories:\n\n${unique.map(c => ` • ${c}`).join('\n')}\n\nAdd new: /addcategory Name`
    );
  }
});

bot.onText(/\/start|\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Budget Tracker Bot 💰

Format: category amount payment

Examples:
• food 500 bpi
• coffee 150 gcash
• gas 2000 bpi

After logging, tap the inline buttons to edit the same entry.

Commands:
/summary — see full monthly breakdown
/categories — list all categories
/addcategory Name — add a new category

Categories: ${Object.keys(categoryMap).join(', ')}`
  );
});

console.log('Budget bot running...');
