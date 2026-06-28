const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.TOKEN;
const SHEET_URL = process.env.SHEET_URL;

if (!TOKEN) { console.error('Missing TOKEN environment variable'); process.exit(1); }
if (!SHEET_URL) { console.error('Missing SHEET_URL environment variable'); process.exit(1); }

process.on('uncaughtException', (err) => { console.error('Uncaught Exception:', err); });
process.on('unhandledRejection', (reason) => { console.error('Unhandled Rejection:', reason); });

const categoryMap = {
  food: 'Food & Dining', coffee: 'Coffee', transport: 'Transportation',
  transpo: 'Transportation', gas: 'Gas', gadgets: 'Gadgets',
  grocery: 'Groceries', groceries: 'Groceries', utilities: 'Utilities',
  bills: 'Utilities', rent: 'Housing / Rent', health: 'Healthcare',
  medicine: 'Healthcare', clothing: 'Clothing', clothes: 'Clothing',
  entertainment: 'Entertainment', invest: 'Investments', savings: 'Savings',
  ipon: 'Savings', education: 'Education', personal: 'Personal Care',
  subscriptions: 'Subscriptions', travel: 'Travel', misc: 'Miscellaneous',
  // Merchants & specific keywords
  fashion: 'Clothing', shirt: 'Clothing', pants: 'Clothing', shoes: 'Clothing', dress: 'Clothing', bag: 'Clothing', 
  // Shopping keywords
  shopping: 'Shopping', accessory: 'Shopping', accessories: 'Shopping', lazada: 'Shopping', shopee: 'Shopping', zalora: 'Shopping', shein: 'Shopping', temu: 'Shopping', mall: 'Shopping', department: 'Shopping',
    furniture: 'Shopping', appliance: 'Shopping', appliances: 'Shopping', decor: 'Shopping', ikea: 'Shopping', abenson: 'Shopping',
  jollibee: 'Food & Dining', mcdo: 'Food & Dining', kfc: 'Food & Dining', chowking: 'Food & Dining', mang: 'Food & Dining', lutong: 'Food & Dining', meal: 'Food & Dining',
  starbucks: 'Coffee', cbtl: 'Coffee', milktea: 'Coffee', gongcha: 'Coffee', chatime: 'Coffee',
  savemore: 'Groceries', puregold: 'Groceries', shopwise: 'Groceries', landers: 'Groceries',
  shell: 'Gas', petron: 'Gas', caltex: 'Gas', seaoil: 'Gas', gasoline: 'Gas', diesel: 'Gas', fuel: 'Gas',
  meralco: 'Utilities', maynilad: 'Utilities', pldt: 'Utilities', converge: 'Utilities', kuryente: 'Utilities',
  netflix: 'Subscriptions', spotify: 'Subscriptions', youtube: 'Subscriptions',
  grab: 'Transportation', angkas: 'Transportation', jeepney: 'Transportation', parking: 'Transportation', toll: 'Transportation', mrt: 'Transportation', lrt: 'Transportation',
  gym: 'Fitness', fitness: 'Fitness', workout: 'Fitness', yoga: 'Fitness',
  xandra: 'Personal Care', haircut: 'Personal Care', salon: 'Personal Care', barbershop: 'Personal Care', grooming: 'Personal Care', spa: 'Personal Care',
  hotel: 'Travel', flight: 'Travel', airfare: 'Travel', airbnb: 'Travel', palawan: 'Travel', boracay: 'Travel',
  stock: 'Investments', crypto: 'Investments', bitcoin: 'Investments', uitf: 'Investments',
};

const categoryEmoji = {
  'Food & Dining': '🍽️', 'Coffee': '☕', 'Transportation': '🚗',
  'Gas': '⛽', 'Gadgets': '📱', 'Groceries': '🛒',
  'Utilities': '💡', 'Housing / Rent': '🏠', 'Healthcare': '🏥',
  'Clothing': '👕', 'Entertainment': '🎉', 'Investments': '📈',
  'Savings': '💰', 'Education': '📚', 'Personal Care': '🧴',
  'Subscriptions': '📺', 'Travel': '✈️', 'Miscellaneous': '📦',
};

const editSessions = new Map();

function getDatPH() { return new Date().toLocaleDateString('en-PH'); }
function h(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function parseAmount(value) {
  if (typeof value === 'number') return value;
  const parsed = parseFloat(String(value).replace(/,/g, '').trim());
  return Number.isNaN(parsed) ? NaN : parsed;
}
function formatMoney(amount) {
  const num = Number(amount || 0);
  return `₱${num.toLocaleString('en-PH', { minimumFractionDigits: num % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
function normalizeCategory(raw) {
  if (!raw) return null;
  return categoryMap[raw.toLowerCase().trim()] || raw.trim();
}
function detectPaymentMethod(text) {
  if (!text) return '';
  const t = text.toLowerCase().trim();
  const methods = ['bpi', 'bdo', 'metrobank', 'unionbank', 'rcbc', 'eastwest', 'landbank', 'pnb', 'maya', 'gcash', 'paypal', 'cash', 'shopeepay', 'coins', 'credit card', 'debit card'];
  const found = methods.find(m => t.includes(m));
  return found || '';
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchTotals(category, userId) {
  try {
    const res = await axios.get(SHEET_URL, {
      params: { action: 'totals', category, userId }
    });
    const d = res.data || {};
    // Map Apps Script fields (total, budget, remaining) to bot fields
    return {
      categoryTotal: d.total || 0,
      categoryBudget: d.budget || 0,
      categoryRemaining: d.remaining || 0,
      overallTotal: d.overallTotal || 0,
    };
  } catch (e) {
    console.error('fetchTotals error:', e.message);
    return { categoryTotal: 0, categoryBudget: 0, categoryRemaining: 0, overallTotal: 0 };
  }
}

async function fetchSummary(userId) {
  try {
    const res = await axios.get(SHEET_URL, {
      params: { action: 'summary', userId }
    });
    return res.data || [];
  } catch (e) {
    console.error('fetchSummary error:', e.message);
    return [];
  }
}

async function fetchGroupSummary() {
  try {
    const res = await axios.get(SHEET_URL, { params: { action: 'groupsummary' } });
    return res.data || [];
  } catch (e) {
    console.error('fetchGroupSummary error:', e.message);
    return [];
  }
}

async function createEntry(data) {
  const res = await axios.post(SHEET_URL, { action: 'create', ...data }, {
    headers: { 'Content-Type': 'application/json' }
  });
  return res.data;
}

async function updateEntry(data) {
  const res = await axios.post(SHEET_URL, { action: 'update', ...data }, {
    headers: { 'Content-Type': 'application/json' }
  });
  return res.data;
}

async function deleteEntry(entryId, userId) {
  const res = await axios.post(SHEET_URL, { action: 'delete', entryId, userId }, {
    headers: { 'Content-Type': 'application/json' }
  });
  return res.data;
}

function buildEntryMessage(entry, totals, userName) {
  const date = h(entry.date);
  const category = h(entry.category);
  const description = h(entry.description || entry.category);
  const notes = h(entry.notes || '-');
  const amount = h(formatMoney(entry.amount));
  const emoji = categoryEmoji[entry.category] || '💸';

  const categoryTotal = h(formatMoney(totals.categoryTotal || 0));
  const overallTotal = h(formatMoney(totals.overallTotal || 0));
  const budget = h(formatMoney(totals.categoryBudget));
  const remaining = totals.categoryRemaining;
  const remAmt = h(formatMoney(Math.abs(remaining || 0)));
  const isOver = remaining < 0;
  const remLine = isOver
    ? `<b>⚠️ Over budget by ${remAmt}!</b>`
    : `Remaining: <b>${remAmt}</b>`;

  return (
    `${emoji} <b>Expense Logged</b>\n` +
    `👤 <i>${h(userName)}</i>\n` +
    `📅 ${date}\n` +
    `🏷️ <b>${category}</b> — ${description}\n` +
    `💵 Amount: <b>${amount}</b>\n` +
    `📝 Notes: ${notes}\n` +
    `\n` +
    `📊 <b>${category} this month:</b>\n` +
    `Spent so far: <b>${categoryTotal}</b>\n` +
    `Budget: <b>${budget}</b>\n` +
    `${remLine}\n` +
    `\n` +
    `💼 Your total this month: <b>${overallTotal}</b>`
  );
}

function buildEditKeyboard(entryId) {
  return {
    inline_keyboard: [
      [
        { text: '✏️ Edit', callback_data: `edit_${entryId}` },
        { text: '🗑️ Delete', callback_data: `delete_${entryId}` },
      ]
    ]
  };
}

const bot = new TelegramBot(TOKEN, { polling: true });

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

// Handle /start
bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId,
    `👋 <b>Budget Tracker Bot</b>\n\n` +
    `Log expenses with:\n<code>category amount description</code>\n\nExample: <code>food 150 bpi</code>\n\n` +
    `Commands:\n/budget — Your monthly summary\n/group — Group members summary`,
    { parse_mode: 'HTML' }
  );
});

// Handle /budget
bot.onText(/^\/budget$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const userName = msg.from.first_name || 'User';
  try {
    const summary = await fetchSummary(userId);
    if (!summary || summary.length === 0) {
      await bot.sendMessage(chatId, `📊 <b>${h(userName)}'s Monthly Summary</b>\n\nNo expenses recorded this month.`, { parse_mode: 'HTML' });
      return;
    }
    let text = `📊 <b>${h(userName)}'s Monthly Summary</b>\n\n`;
    let grandTotal = 0;
    for (const item of summary) {
      const emoji = categoryEmoji[item.category] || '💸';
      const spent = item.total || 0;
      grandTotal += spent;
      const budget = item.budget || 0;
      const remaining = item.remaining || 0;
      const isOver = remaining < 0;
      const remText = isOver ? `⚠️ Over by ${formatMoney(Math.abs(remaining))}` : `Remaining: ${formatMoney(remaining)}`;
      text += `${emoji} <b>${h(item.category)}</b>: ${formatMoney(spent)}`;
      if (budget > 0) text += ` / ${formatMoney(budget)} — ${remText}`;
      text += `\n`;
    }
    text += `\n💼 <b>Total: ${formatMoney(grandTotal)}</b>`;
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('/budget error:', e.message);
    await bot.sendMessage(chatId, '❌ Could not fetch budget summary. Try again later.');
  }
});

// Handle /group
bot.onText(/^\/group$/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const summary = await fetchGroupSummary();
    if (!summary || summary.length === 0) {
      await bot.sendMessage(chatId, `👥 <b>Group Monthly Summary</b>\n\nNo expenses recorded this month.`, { parse_mode: 'HTML' });
      return;
    }
    let text = `👥 <b>Group Monthly Summary</b>\n\n`;
    for (const item of summary) {
      text += `👤 <b>${h(item.userName || item.userId)}</b>: ${formatMoney(item.total)}\n`;
    }
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('/group error:', e.message);
    await bot.sendMessage(chatId, '❌ Could not fetch group summary. Try again later.');
  }
});

// Handle callback queries (edit/delete buttons)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = String(query.from.id);
  const data = query.data;

  if (data.startsWith('delete_')) {
    const entryId = data.replace('delete_', '');
    try {
      await deleteEntry(entryId, userId);
      await bot.editMessageText('🗑️ Entry deleted.', {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
    } catch (e) {
      console.error('delete error:', e.message);
      await bot.answerCallbackQuery(query.id, { text: 'Failed to delete.' });
    }
    return;
  }

  if (data.startsWith('edit_')) {
    const entryId = data.replace('edit_', '');
    editSessions.set(userId, { entryId, messageId: query.message.message_id, chatId });
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId,
      `✏️ <b>Editing entry</b>\n\nSend the new values in this format:\n<code>category amount description</code>\n\nExample: <code>food 200 bdo</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  await bot.answerCallbackQuery(query.id);
});

// Main message handler
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const userName = msg.from.first_name || 'User';
  const text = msg.text.trim();

  // Check if this is an edit session
  if (editSessions.has(userId)) {
    const session = editSessions.get(userId);
    editSessions.delete(userId);

    const parts = text.split(/\s+/);
    const categoryRaw = parts[0];
    const amountRaw = parts[1];
    const amount = parseAmount(amountRaw);

    if (isNaN(amount)) {
      await bot.sendMessage(chatId, '❌ Invalid format. Use: <code>category amount description</code>', { parse_mode: 'HTML' });
      return;
    }

    const category = normalizeCategory(categoryRaw) || 'Miscellaneous';
    const description = parts.slice(2).join(' ') || category;

    try {
      await updateEntry({ entryId: session.entryId, amount, category, description });
      const totals = await fetchTotals(category, userId);
              const summary = await fetchSummary(userId);
        totals.overallTotal = summary.reduce((sum, item) => sum + (item.total || 0), 0);
      const updatedEntry = { date: getDatPH(), category, description, amount, notes: '' };
      const newText = buildEntryMessage(updatedEntry, totals, userName);
      await bot.editMessageText(newText, {
        chat_id: session.chatId,
        message_id: session.messageId,
        parse_mode: 'HTML',
        reply_markup: buildEditKeyboard(session.entryId),
      });
      await bot.sendMessage(chatId, '✅ Entry updated!', { parse_mode: 'HTML' });
    } catch (e) {
      console.error('edit error:', e.message);
      await bot.sendMessage(chatId, '❌ Failed to update entry.');
    }
    return;
  }

  // New expense entry
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await bot.sendMessage(chatId,
      `❌ Invalid format. Use:\n<code>category amount description</code>\n\nExample: <code>food 150 bpi</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const categoryRaw = parts[0];
  const amountRaw = parts[1];
  const amount = parseAmount(amountRaw);

  if (isNaN(amount) || amount <= 0) {
    await bot.sendMessage(chatId,
      `❌ Invalid amount "${h(amountRaw)}". Use:\n<code>food 150 bpi</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const category = normalizeCategory(categoryRaw) || 'Miscellaneous';
    const extraText = parts.slice(2).join(' ');
  const paymentMethod = detectPaymentMethod(extraText);
  const description = categoryRaw !== category ? categoryRaw : (extraText && !paymentMethod ? extraText : category);
  const notes = paymentMethod || '';
  const date = getDatPH();
  const type = 'Expense';

  try {
    const result = await createEntry({
            amount, category, description, notes, date, type, chatId, userId, userName
    });

    console.log('createEntry result:', JSON.stringify(result));

    const totals = await fetchTotals(category, userId);
            const summary = await fetchSummary(userId);
        totals.overallTotal = summary.reduce((sum, item) => sum + (item.total || 0), 0);
    console.log('fetchTotals result:', JSON.stringify(totals));

            const entry = { date, category, description, amount, notes };
    const msgText = buildEntryMessage(entry, totals, userName);

    await bot.sendMessage(chatId, msgText, {
      parse_mode: 'HTML',
      reply_markup: buildEditKeyboard(result.entryId || ''),
    });
  } catch (e) {
    console.error('createEntry error:', e.message, e.stack);
    await bot.sendMessage(chatId, `❌ Failed to log expense. Error: ${e.message}`);
  }
});

console.log('Bot started polling...');
