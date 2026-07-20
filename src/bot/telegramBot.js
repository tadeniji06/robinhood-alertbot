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
  bot.onText(/\/start(@\w+)?/, async (msg) => {
    const chatId  = msg.chat.id;
    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup' || msg.chat.type === 'channel';
    const isNew   = db.addSubscriber(msg);
    const name    = isGroup
      ? (msg.chat.title || 'this group')
      : (msg.from?.first_name || msg.from?.username || 'there');

    if (isNew) {
      const welcome = isGroup ? [
        `👋 <b>Hey! Robinhood Chain Alert Bot is now active in ${esc(name)}!</b>`,
        ``,
        `🔔 This group will receive <b>live token launch alerts</b> for:`,
        `  🌉 <b>Pons</b> — pons.family/launchpad`,
        `  🥔 <b>Potato Pad</b> — potato.fm`,
        `  🎯 <b>Pew.fun</b> — pew.fun`,
        ``,
        `Every new token launch will be posted here automatically.`,
        ``,
        `<b>Commands:</b>`,
        `  /start — Activate alerts`,
        `  /stop  — Deactivate alerts`,
        `  /stats — Bot stats`,
        ``,
        `<i>⚠️ Not financial advice. Always DYOR.</i>`,
      ].join('\n') : [
        `👋 <b>Hey ${esc(name)}! Welcome to the Robinhood Chain Alert Bot.</b>`,
        ``,
        `🔔 You're now <b>subscribed to live token alerts</b>!`,
        ``,
        `Every time a new token launches on:`,
        `  🌉 <b>Pons</b> — pons.family/launchpad`,
        `  🥔 <b>Potato Pad</b> — potato.fm`,
        `  🎯 <b>Pew.fun</b> — pew.fun`,
        ``,
        `…you'll get an instant alert right here.`,
        ``,
        `<b>Commands:</b>`,
        `  /start — Subscribe to alerts`,
        `  /stop  — Unsubscribe from alerts`,
        `  /stats — See bot stats`,
        ``,
        `<i>⚠️ Not financial advice. Always DYOR.</i>`,
      ].join('\n');

      await safeSend(chatId, welcome);
    } else {
      await safeSend(chatId,
        `✅ <b>Already subscribed!</b>\n\nAlerts are active. Send /stop to deactivate.`
      );
    }
  });

  // ── /stop ─────────────────────────────────────────────────────────────────
  bot.onText(/\/stop(@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    db.removeSubscriber(chatId);
    await safeSend(chatId,
      `🚫 <b>Alerts deactivated.</b>\n\nYou won't receive any more token alerts.\n\nSend /start to re-activate anytime.`
    );
  });

  // ── /stats ────────────────────────────────────────────────────────────────
  bot.onText(/\/stats/, async (msg) => {
    const total = db.count();
    await safeSend(msg.chat.id,
      `📊 <b>Bot Stats</b>\n\n👥 Active Subscribers: <b>${total}</b>\n🔗 Network: Robinhood Chain (ID: 4663)\n📡 Monitoring: Pons + Potato Pad`
    );
  });

  // ── /chatid ───────────────────────────────────────────────────────────────
  bot.onText(/\/chatid/, async (msg) => {
    await safeSend(msg.chat.id,
      `📌 <b>Chat ID:</b> <code>${msg.chat.id}</code>\n\n<i>Copy this ID into your .env file to route specific alerts here.</i>`
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

// Helper to resolve IPFS to HTTP gateway
function resolveImage(uri) {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) {
    return `https://dweb.link/ipfs/${uri.replace('ipfs://', '')}`;
  }
  return uri;
}

/**
 * Broadcasts an HTML alert.
 * If segregated channels are configured in .env, sends ONLY to those channels.
 * Otherwise, broadcasts to ALL subscribers.
 * Automatically removes subscribers who have blocked the bot (in broadcast mode).
 * @param {string} html
 * @param {string} [imageUrl]
 * @param {string} [launchpad]
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function broadcastAlert(html, imageUrl = null, launchpad = null) {
  if (!bot) init();
  
  // 1. Determine Target IDs
  const c = config.telegram.channels;
  let targetIds = [];
  let isSegregatedMode = false;

  if (c.all || c.pons || c.potato || c.pew) {
    isSegregatedMode = true;
    if (c.all) targetIds.push(c.all);
    
    if (launchpad) {
      if (launchpad.toLowerCase().includes('pons') && c.pons) targetIds.push(c.pons);
      if (launchpad.toLowerCase().includes('potato') && c.potato) targetIds.push(c.potato);
      if (launchpad.toLowerCase().includes('pew') && c.pew) targetIds.push(c.pew);
    }
    
    // Deduplicate IDs (e.g. if 'all' is the same as 'pons')
    targetIds = [...new Set(targetIds)];
  } else {
    // Fallback: send to everyone in subscribers.json
    targetIds = db.getAllIds();
  }

  if (targetIds.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  // Fetch image buffer if available
  let imageBuffer = null;
  if (imageUrl) {
    try {
      const resolvedUrl = resolveImage(imageUrl);
      const axios = require('axios');
      const res = await axios.get(resolvedUrl, { responseType: 'arraybuffer', timeout: 5000 });
      imageBuffer = Buffer.from(res.data, 'binary');
    } catch (err) {
      logger.warn('telegram', `Failed to download image from ${imageUrl}: ${err.message}`);
    }
  }

  for (const chatId of targetIds) {
    try {
      if (imageBuffer) {
        try {
          await retry(
            () => bot.sendPhoto(chatId, imageBuffer, {
              caption: html,
              parse_mode: 'HTML',
            }, {
              filename: 'token_image.png',
              contentType: 'image/png'
            }),
            3, 1000, `broadcast.photo.${chatId}`
          );
        } catch (err) {
          logger.warn('telegram', `Failed to send photo buffer to ${chatId}, falling back to text:`, err.message);
          await retry(
            () => bot.sendMessage(chatId, html, { parse_mode: 'HTML', disable_web_page_preview: true }),
            3, 1000, `broadcast.text.${chatId}`
          );
        }
      } else {
        await retry(
          () => bot.sendMessage(chatId, html, { parse_mode: 'HTML', disable_web_page_preview: true }),
          3, 1000, `broadcast.text.${chatId}`
        );
      }
      sent++;
      // Respect Telegram rate limits: ~30 messages/sec max
      await sleep(40);
    } catch (err) {
      failed++;
      logger.error('telegram', `Broadcast failed for ${chatId}:`, err.message);
      
      // Only auto-remove from DB if we are broadcasting to standard subscribers (not segregated channels)
      if (!isSegregatedMode && err.message.includes('bot was blocked by the user')) {
        db.removeSubscriber(chatId);
      }
      
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
