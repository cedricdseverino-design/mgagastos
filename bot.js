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
};

const categoryEmoji = {
  'Food & Dining': '🍽', 'Coffee': '☕', 'Transportation': '🚗',
  'Gas': '⛽', 'Gadgets': '📱', 'Groceries': '🛒',
  'Utilities': '💡', 'Housing / Rent': '🏠', 'Healthcare': '🏥',
  'Clothing': '👕', 'Entertainment': '🎉', 'Investments': '📈',
  'Savings': '💰', 'Education': '📚', 'Personal Care': '🛁',
  'Subscriptions': '🔄', 'Travel': '✈️', 'Miscellaneous': '🗂',
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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildEntryMessage(entry, totals, userName) {
  const date = h(entry.date);
  const category = h(entry.category);
  const description = h(entry.description || entry.category);
  const notes = h(entry.notes || '-');
  const amount = h(formatMoney(entry.amount));
  const type = h(entry.type || 'Expense');
  const emoji = categoryEmoji[entry.category] || '💸';
  const user = h(userName || 'Unknown');

  let text = `${emoji} <b>Logged!</b> <i>(by ${user})</i>\n`
    + `📅 <b>Date:</b> ${date}\n`
    + `🏷 <b>Category:</b> ${category}\n`
    + `📝 <b>Description:</b> ${description}\n`
    + `💸 <b>Amount:</b> ${amount}\n`
    + `📊 <b>Type:</b> ${type}\n`
    + `📋 <b>Notes:</b> ${notes}`;

  if (totals) {
    const month = h(totals.month || 'This month');
    const categoryTotal = h(formatMoney(totals.categoryTotal || 0));
    const overallTotal = h(formatMoney(totals.overallTotal || 0));
    text += `\n\n📊 <b>${month} — ${category}</b> <i>(your share)</i>\nSpent so far: <b>${categoryTotal}</b>`;
    if (totals.categoryBudget != null) {
      const budget = h(formatMoney(totals.categoryBudget));
      const remaining = totals.categoryRemaining;
      const remAmt = h(formatMoney(Math.abs(remaining || 0)));
      text += `\n🎯 Budget: <b>${budget}</b>`;
      if (remaining != null) {
        text += remaining >= 0
          ? `\n✅ Remaining: <b>${remAmt}</b>`
          : `\n⚠️ Over budget by: <b>${remAmt}</b>`;
      }
    }
    text += `\n\n💳 <b>Your total this month:</b> ${overallTotal}`;
  }
  return text;
}

function buildEditKeyboard(entryId) {
  return {
    inline_keyboard: [
      [{ text: '✏️ Edit Amount', callback_data: `edit:${entryId}:amount` }, { text: '📝 Edit Notes', callback_data: `edit:${entryId}:notes` }],
      [{ text: '🗑️ Delete Entry', callback_data: `delete:${entryId}` }],
    ],
  };
}
function buildCancelKeyboard(entryId) {
  return { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `cancel:${entryId}` }]] };
}

async function fetchTotals(category, userId) {
  try {
    const res = await axios.get(SHEET_URL, { params: { action: 'totals', category, userId } });
    return res.data;
  } catch (e) { console.error('fetchTotals error:', e.message); return null; }
}
async function fetchSummary(userId) {
  try {
    const res = await axios.get(SHEET_URL, { params: { action: 'summary', userId } });
    return res.data;
  } catch (e) { console.error('fetchSummary error:', e.message); return null; }
}
async function fetchGroupSummary() {
  try {
    const res = await axios.get(SHEET_URL, { params: { action: 'groupsummary' } });
    return res.data;
  } catch (e) { console.error('fetchGroupSummary error:', e.message); return null; }
}
async function createEntry(entryData) {
  const res = await axios.post(SHEET_URL, { action: 'create', ...entryData });
  return res.data;
}
async function updateEntry(entryId, field, value) {
  const res = await axios.post(SHEET_URL, { action: 'update', entryId, field, value });
  return res.data;
}
async function deleteEntry(entryId) {
  const res = await axios.post(SHEET_URL, { action: 'delete', entryId });
  return res.data;
}
async function refreshEntryMessage(bot, chatId, messageId, entryId) {
  try {
    const res = await axios.get(SHEET_URL, { params: { action: 'get', entryId } });
    const entry = res.data;
    if (!entry || entry.error) return;
    const totals = await fetchTotals(entry.category, entry.userId);
    const text = buildEntryMessage(entry, totals, entry.userName);
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'HTML', reply_markup: buildEditKeyboard(entryId),
    });
  } catch (e) { console.error('refreshEntryMessage error:', e.message); }
}

async function handleBudgetCommand(bot, chatId, userId, userName) {
  try {
    const summary = await fetchSummary(userId);
    if (!summary || summary.error) {
      await bot.sendMessage(chatId, '❌ Could not fetch budget summary. Please try again later.');
      return;
    }
    const month = h(summary.month || 'This month');
    const overallTotal = formatMoney(summary.overallTotal || 0);
    let text = `📊 <b>${h(userName)}'s Budget — ${month}</b>\n━━━━━━━━━━━━━━━━━━\n`;
    text += `💳 <b>Total Spent:</b> ${h(overallTotal)}\n`;
    if (summary.overallBudget) {
      text += `🎯 <b>Total Budget:</b> ${h(formatMoney(summary.overallBudget))}\n`;
      const rem = summary.overallRemaining;
      if (rem != null) {
        text += rem >= 0
          ? `✅ <b>Remaining:</b> ${h(formatMoney(rem))}\n`
          : `⚠️ <b>Over budget by:</b> ${h(formatMoney(Math.abs(rem)))}\n`;
      }
    }
    if (summary.categories && summary.categories.length > 0) {
      text += `\n<b>By Category:</b>\n━━━━━━━━━━━━━━━━━━\n`;
      for (const cat of summary.categories) {
        const emoji = categoryEmoji[cat.category] || '💸';
        text += `${emoji} <b>${h(cat.category)}:</b> ${h(formatMoney(cat.spent))}`;
        if (cat.budget) {
          text += ` / ${h(formatMoney(cat.budget))}`;
          const r = cat.remaining;
          if (r != null) text += r >= 0 ? ` ✅ <i>(${h(formatMoney(r))} left)</i>` : ` ⚠️ <i>(over by ${h(formatMoney(Math.abs(r)))})</i>`;
        }
        text += `\n`;
      }
    }
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (e) {
    await bot.sendMessage(chatId, `❌ Error: ${e.message}`);
  }
}

async function handleGroupSummaryCommand(bot, chatId) {
  try {
    const summary = await fetchGroupSummary();
    if (!summary || summary.error) {
      await bot.sendMessage(chatId, '❌ Could not fetch group summary.');
      return;
    }
    const month = h(summary.month || 'This month');
    let text = `👥 <b>Group Summary — ${month}</b>\n━━━━━━━━━━━━━━━━━━\n`;
    text += `💳 <b>Total (all members):</b> ${h(formatMoney(summary.overallTotal || 0))}\n`;
    if (summary.users && summary.users.length > 0) {
      text += `\n<b>Per Person:</b>\n━━━━━━━━━━━━━━━━━━\n`;
      for (const u of summary.users) {
        text += `👤 <b>${h(u.userName)}:</b> ${h(formatMoney(u.total))}\n`;
        if (u.topCategories && u.topCategories.length > 0) {
          for (const cat of u.topCategories) {
            const emoji = categoryEmoji[cat.category] || '💸';
            text += `  ${emoji} ${h(cat.category)}: ${h(formatMoney(cat.spent))}\n`;
          }
        }
      }
    }
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (e) {
    await bot.sendMessage(chatId, `❌ Error: ${e.message}`);
  }
}

function attachHandlers(bot) {
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = String(msg.from.id);
    const userName = msg.from.first_name || msg.from.username || 'User';

    if (!text) return;

    if (text === '/budget' || text === '/summary' || text === '/b' || text === `/budget@${msg.botInfo}`) {
      await handleBudgetCommand(bot, chatId, userId, userName);
      return;
    }
    if (text === '/group' || text === '/all' || text === '/groupbudget') {
      await handleGroupSummaryCommand(bot, chatId);
      return;
    }
    if (text === '/start' || text === '/help') {
      await bot.sendMessage(chatId,
        `👋 <b>Budget Bot</b>\n\n`
        + `Log an expense:\n<code>category amount description</code>\n`
        + `Example: <code>food 150 bpi</code>\n\n`
        + `Commands:\n`
        + `/budget — 📊 Your monthly summary\n`
        + `/group — 👥 Everyone's summary\n`
        + `/help — ℹ️ Show this help`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (text.startsWith('/')) return;

    const session = editSessions.get(chatId + ':' + userId);
    if (session) {
      editSessions.delete(chatId + ':' + userId);
      const { entryId, field, messageId } = session;
      try {
        await updateEntry(entryId, field, text.trim());
        await bot.sendMessage(chatId, `✅ ${h(userName)}'s entry updated!`, { parse_mode: 'HTML' });
        await refreshEntryMessage(bot, chatId, messageId, entryId);
      } catch (e) {
        await bot.sendMessage(chatId, `❌ Error updating: ${e.message}`);
      }
      return;
    }

    const parts = text.trim().split(/\s+/);
    const categoryRaw = parts[0];
    const amountRaw = parts[1];
    const amount = parseAmount(amountRaw);

    if (isNaN(amount)) {
      await bot.sendMessage(chatId,
        `❌ Invalid format. Use: <b>category amount description</b>\nExample: <code>food 150 bpi</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const category = normalizeCategory(categoryRaw) || 'Miscellaneous';
    const description = parts.slice(2).join(' ') || category;
    const date = getDatPH();
    const type = 'Expense';

    try {
      const result = await createEntry({ amount, category, description, notes: '', date, type, chatId, userId, userName });
      const entryId = result.entryId;
      const totals = await fetchTotals(category, userId);
      const msgText = buildEntryMessage({ amount, category, description, notes: '', date, type }, totals, userName);
      const sent = await bot.sendMessage(chatId, msgText, {
        parse_mode: 'HTML',
        reply_markup: buildEditKeyboard(entryId),
      });
      if (result.rowIndex) {
        await axios.post(SHEET_URL, { action: 'attachMessage', entryId, chatId, messageId: sent.message_id });
      }
    } catch (e) {
      console.error('Error creating entry:', e.message);
      await bot.sendMessage(chatId, `❌ Error logging expense: ${e.message}`);
    }
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const userId = String(query.from.id);
    const userName = query.from.first_name || query.from.username || 'User';

    await bot.answerCallbackQuery(query.id);

    if (data.startsWith('edit:')) {
      const [, entryId, field] = data.split(':');
      editSessions.set(chatId + ':' + userId, { entryId, field, messageId });
      await bot.sendMessage(chatId, `✏️ ${h(userName)}, send the new value for <b>${h(field)}</b>:`, {
        parse_mode: 'HTML',
        reply_markup: buildCancelKeyboard(entryId),
      });
    } else if (data.startsWith('delete:')) {
      const [, entryId] = data.split(':');
      try {
        await deleteEntry(entryId);
        await bot.editMessageText('🗑️ Entry deleted.', { chat_id: chatId, message_id: messageId });
      } catch (e) {
        await bot.sendMessage(chatId, `❌ Error deleting: ${e.message}`);
      }
    } else if (data.startsWith('cancel:')) {
      editSessions.delete(chatId + ':' + userId);
      await bot.deleteMessage(chatId, messageId);
    }
  });
}

async function startPolling() {
  try {
    await axios.post(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`, { drop_pending_updates: true });
    console.log('Webhook cleared.');
  } catch (e) { console.error('Could not clear webhook:', e.message); }

  console.log('Waiting 15s for old instances to stop...');
  await sleep(15000);

  console.log('Starting polling...');
  const bot = new TelegramBot(TOKEN, { polling: true });
  attachHandlers(bot);

  let restarting = false;
  bot.on('polling_error', async (err) => {
    console.error('[polling_error]', JSON.stringify({ code: err.code, message: err.message }));
    if (err.code === 'ETELEGRAM' && err.message.includes('409') && !restarting) {
      restarting = true;
      console.log('409 conflict, restarting in 15s...');
      try { await bot.stopPolling(); } catch (e) { /* ignore */ }
      await sleep(15000);
      restarting = false;
      try { await bot.startPolling(); } catch (e) { console.error('Failed to restart:', e.message); }
    }
  });

  console.log('Budget bot running...');
}

startPolling();
