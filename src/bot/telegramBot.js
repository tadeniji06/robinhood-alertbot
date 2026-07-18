'use strict';

const TelegramBot = require('node-telegram-bot-api');
const config      = require('../config');
const logger      = require('../utils/logger');
const { retry, sleep } = require('../utils/retry');
const db          = require('../db/subscribers');

let bot;

// ── Initialise ────────────────────────────────────────────────────────────────

/**
 * Initialises the Telegram bot in polling mode (interactive).
 * Registers all command handlers.
 * @returns {TelegramBot}
 */
function init() {
  if (bot) return bot;

  bot = new TelegramBot(config.telegram.token, {
    polling: {
      interval: 1000,        // poll every second
      autoStart: true,
      params: { timeout: 10 },
    },
  });

  // ── /start ────────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user   = msg.from;
    const isNew  = db.addSubscriber(user);
    const name   = user.first_name || user.username || 'there';

    if (isNew) {
      const welcome = [
        `👋 <b>Hey ${esc(name)}! Welcome to the Robinhood Chain Alert Bot.</b>`,
        ``,
        `🔔 You're now <b>subscribed to live token alerts</b>!`,
        ``,
        `Every time a new token launches on:`,
        `  🌉 <b>Pons</b> — <a href="https://pons.family/launchpad">pons.family/launchpad</a>`,
        `  🥔 <b>Potato Pad</b> — <a href="https://potato.fm">potato.fm</a>`,
        ``,
        `…you'll get an instant alert right here in your DMs.`,
        ``,
        `<b>Commands:</b>`,
        `  /start — Subscribe to alerts`,
        `  /stop  — Unsubscribe from alerts`,
        `  /stats — See bot subscriber stats`,
        ``,
        `<i>⚠️ All alerts are for informational purposes only. DYOR — Not financial advice.</i>`,
      ].join('\n');

      await safeSend(chatId, welcome);
    } else {
      await safeSend(chatId,
        `✅ <b>You're already subscribed!</b>\n\nYou'll receive automatic alerts for every new token launch on Robinhood Chain.\n\nSend /stop to unsubscribe at any time.`
      );
    }
  });

  // ── /stop ─────────────────────────────────────────────────────────────────
  bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    db.removeSubscriber(chatId);
    await safeSend(chatId,
      `🚫 <b>You've been unsubscribed.</b>\n\nYou won't receive any more token alerts.\n\nSend /start to re-subscribe anytime.`
    );
  });

  // ── /stats ────────────────────────────────────────────────────────────────
  bot.onText(/\/stats/, async (msg) => {
    const total = db.count();
    await safeSend(msg.chat.id,
      `📊 <b>Bot Stats</b>\n\n👥 Active Subscribers: <b>${total}</b>\n🔗 Network: Robinhood Chain (ID: 4663)\n📡 Monitoring: Pons + Potato Pad`
    );
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  bot.on('polling_error', (err) => {
    logger.error('telegram', 'Polling error:', err.message);
  });

  bot.on('error', (err) => {
    logger.error('telegram', 'Bot error:', err.message);
  });

  logger.info('telegram', '✅ Bot started in polling mode — accepting /start commands');
  return bot;
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

/**
 * Broadcasts an HTML alert to ALL subscribers.
 * Automatically removes subscribers who have blocked the bot.
 * @param {string} html
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function broadcastAlert(html) {
  if (!bot) init();
  const ids = db.getAllIds();

  if (ids.length === 0) {
    logger.warn('telegram', 'No subscribers — nobody to send alert to.');
    return { sent: 0, failed: 0 };
  }

  logger.info('telegram', `📢 Broadcasting to ${ids.length} subscribers…`);
  let sent = 0, failed = 0;

  for (const chatId of ids) {
    try {
      await retry(
        () => bot.sendMessage(chatId, html, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        3, 1000, `broadcast.${chatId}`
      );
      sent++;
      // Respect Telegram rate limits: ~30 messages/sec max
      await sleep(40);
    } catch (err) {
      failed++;
      const code = err?.response?.body?.error_code;
      // 403 = user blocked bot, 400 chat not found → remove subscriber
      if (code === 403 || code === 400) {
        logger.warn('telegram', `Removing blocked/unavailable subscriber: ${chatId}`);
        db.removeSubscriber(chatId);
      } else if (code === 429) {
        const wait = (err?.response?.body?.parameters?.retry_after ?? 5) * 1000;
        logger.warn('telegram', `Rate limited — waiting ${wait}ms`);
        await sleep(wait);
      } else {
        logger.error('telegram', `Failed to send to ${chatId}:`, err.message);
      }
    }
  }

  logger.info('telegram', `✅ Broadcast complete — sent: ${sent}, failed: ${failed}`);
  return { sent, failed };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Safe send — silently swallows errors so a bad send never crashes the bot.
 */
async function safeSend(chatId, html) {
  try {
    await bot.sendMessage(chatId, html, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    logger.warn('telegram', `safeSend failed for ${chatId}:`, err.message);
  }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { init, broadcastAlert };
