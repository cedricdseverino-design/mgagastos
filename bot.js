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

// Create bot WITHOUT polling first so we can clear webhook/offset
const bot = new TelegramBot(TOKEN, { polling: false });

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

function getDatPH() {
  return new Date().toLocaleDateString('en-PH');
}

function h(text) {
  return String(text != null ? text : '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseAmount(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function formatMoney(amount) {
  const num = Number(amount || 0);
  return 'P' + num.toLocaleString('en-PH', {
    minimumFractionDigits: num % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function buildEntryMessage(entry, totals) {
  const date = h(entry.date);
  const category = h(entry.category);
  const description = h(entry.description || entry.category);
  const notes = h(entry.notes || '-');
  const amount = h(formatMoney(entry.amount));
  const type = h(entry.type || 'Expense');

  let text =
    '<b>Logged!</b>\n' +
    '<b>Date:</b> ' + date + '\n' +
    '<b>Category:</b> ' + category + '\n' +
    '<b>Description:</b> ' + description + '\n' +
    '<b>Amount:</b> ' + amount + '\n' +
    '<b>Type:</b> ' + type + '\n' +
    '<b>Notes:</b> ' + notes;

  if (totals) {
    const month = h(totals.month || 'This month');
    const categoryTotal = h(formatMoney(totals.categoryTotal || 0));
    const overallTotal = h(formatMoney(totals.overallTotal || 0));

    text += '\n\n<b>' + month + ' - ' + category + '</b>\nSpent so far: <b>' + categoryTotal + '</b>';

    if (totals.categoryBudget !== null && totals.categoryBudget !== undefined) {
      const budget = h(formatMoney(totals.categoryBudget));
      const remaining = totals.categoryRemaining;
      const remainingAmt = h(formatMoney(Math.abs(remaining || 0)));
      text += '\nBudget: <b>' + budget + '</b>';
      if (remaining !== null && remaining !== undefined) {
        if (remaining >= 0) {
          text += '\nRemaining: <b>' + remainingAmt + '</b>';
        } else {
          text += '\nOver budget by: <b>' + remainingAmt + '</b>';
        }
      }
    }

    text += '\n\n<b>All expenses this month:</b> ' + overallTotal;
  }

  return text;
}

function buildEditKeyboard(entryId) {
  return {
    inline_keyboard: [
      [
        { text: 'Edit Amount', callback_data: 'edit:' + entryId + ':amount' },
        { text: 'Edit Notes', callback_data: 'edit:' + entryId + ':notes' },
      ],
      [
        { text: 'Delete Entry', callback_data: 'delete:' + entryId },
      ],
    ],
  };
}

function buildCancelKeyboard(entryId) {
  return {
    inline_keyboard: [
      [{ text: 'Cancel', callback_data: 'cancel:' + entryId }],
    ],
  };
}

async function fetchTotals(category) {
  try {
    const res = await axios.get(SHEET_URL, { params: { action: 'totals', category: category } });
    return res.data;
  } catch (e) {
    console.error('fetchTotals error:', e.message);
    return null;
  }
}

async function createEntry(entryData) {
  const res = await axios.post(SHEET_URL, Object.assign({ action: 'create' }, entryData));
  return res.data;
}

async function updateEntry(entryId, field, value) {
  const res = await axios.post(SHEET_URL, { action: 'update', entryId: entryId, field: field, value: value });
  return res.data;
}

async function deleteEntry(entryId) {
  const res = await axios.post(SHEET_URL, { action: 'delete', entryId: entryId });
  return res.data;
}

function normalizeCategory(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  return categoryMap[lower] || raw.trim();
}

async function refreshEntryMessage(chatId, messageId, entryId) {
  try {
    const res = await axios.get(SHEET_URL, { params: { action: 'get', entryId: entryId } });
    const entry = res.data;
    if (!entry || entry.error) return;
    const totals = await fetchTotals(entry.category);
    const text = buildEntryMessage(entry, totals);
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: buildEditKeyboard(entryId),
    });
  } catch (e) {
    console.error('refreshEntryMessage error:', e.message);
  }
}

bot.on('message', async function(msg) {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const session = editSessions.get(chatId);
  if (session) {
    editSessions.delete(chatId);
    const entryId = session.entryId;
    const field = session.field;
    const messageId = session.messageId;
    try {
      await updateEntry(entryId, field, text.trim());
      await bot.sendMessage(chatId, 'Entry updated!');
      await refreshEntryMessage(chatId, messageId, entryId);
    } catch (e) {
      await bot.sendMessage(chatId, 'Error updating entry: ' + e.message);
    }
    return;
  }

  const parts = text.trim().split(/\s+/);
  const amountRaw = parts[0];
  const amount = parseAmount(amountRaw);

  if (isNaN(amount)) {
    return;
  }

  const categoryRaw = parts[1] || '';
  const category = normalizeCategory(categoryRaw) || 'Miscellaneous';
  const description = parts.slice(2).join(' ') || category;
  const notes = '';
  const date = getDatPH();
  const type = 'Expense';

  try {
    const result = await createEntry({ amount: amount, category: category, description: description, notes: notes, date: date, type: type, chatId: chatId });
    const entryId = result.entryId;
    const totals = await fetchTotals(category);
    const entryData = { amount: amount, category: category, description: description, notes: notes, date: date, type: type };
    const msgText = buildEntryMessage(entryData, totals);

    const sent = await bot.sendMessage(chatId, msgText, {
      parse_mode: 'HTML',
      reply_markup: buildEditKeyboard(entryId),
    });

    if (result.rowIndex) {
      await axios.post(SHEET_URL, {
        action: 'attachMessage',
        entryId: entryId,
        chatId: chatId,
        messageId: sent.message_id,
      });
    }
  } catch (e) {
    console.error('Error creating entry:', e.message);
    await bot.sendMessage(chatId, 'Error logging expense: ' + e.message);
  }
});

bot.on('callback_query', async function(query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  if (data.startsWith('edit:')) {
    const parts = data.split(':');
    const entryId = parts[1];
    const field = parts[2];
    editSessions.set(chatId, { entryId: entryId, field: field, messageId: messageId });
    await bot.sendMessage(chatId, 'Send the new value for <b>' + field + '</b>:', {
      parse_mode: 'HTML',
      reply_markup: buildCancelKeyboard(entryId),
    });
  } else if (data.startsWith('delete:')) {
    const entryId = data.split(':')[1];
    try {
      await deleteEntry(entryId);
      await bot.editMessageText('Entry deleted.', {
        chat_id: chatId,
        message_id: messageId,
      });
    } catch (e) {
      await bot.sendMessage(chatId, 'Error deleting: ' + e.message);
    }
  } else if (data.startsWith('cancel:')) {
    editSessions.delete(chatId);
    await bot.deleteMessage(chatId, messageId);
  }
});

bot.on('polling_error', function(err) {
  console.error('[polling_error]', err.code, err.message);
});

// Clear any existing webhook and pending updates, then start polling fresh
async function start() {
  try {
    await bot.deleteWebhook({ drop_pending_updates: true });
    console.log('Webhook cleared, starting polling...');
    bot.startPolling({ restart: false });
    console.log('Budget bot running...');
  } catch (e) {
    console.error('Startup error:', e.message);
    process.exit(1);
  }
}

start();
