'use strict';

require('dotenv').config();

const config         = require('./config');
const PonsListener   = require('./listeners/ponsListener');
const PotatoListener = require('./listeners/potatoListener');
const { enrichToken }  = require('./enrichers/tokenEnricher');
const { formatAlert }  = require('./formatters/alertFormatter');
const telegramBot      = require('./bot/telegramBot');
const logger           = require('./utils/logger');
const db               = require('./db/subscribers');
const blockscout       = require('./utils/blockscout');

// ── Event pipeline ────────────────────────────────────────────────────────────

async function handleNewToken(rawToken) {
  try {
    logger.info('main', `🔔 New token: ${rawToken.tokenAddress} (${rawToken.launchpad})`);
    // No provider passed — enricher uses Blockscout API only
    const enriched = await enrichToken(rawToken);
    const message  = formatAlert(enriched);
    await telegramBot.broadcastAlert(message);
  } catch (err) {
    logger.error('main', `Failed to process token ${rawToken.tokenAddress}:`, err.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('main', '🚀 Robinhood Alert Bot starting…');
  logger.info('main', `Chain ID: ${config.rpc.chainId}`);

  // Verify Blockscout is reachable (our primary data source)
  try {
    const latestBlock = await blockscout.getLatestBlock();
    logger.info('main', `✅ Blockscout connected — latest block: ${latestBlock}`);
  } catch (err) {
    logger.error('main', '❌ Cannot reach Blockscout API:', err.message);
    process.exit(1);
  }

  // Start interactive Telegram bot (polling for /start, /stop, /stats)
  telegramBot.init();

  // Create & start listeners (Blockscout-based — zero RPC calls)
  const ponsListener   = new PonsListener();
  const potatoListener = new PotatoListener();

  ponsListener.on('newToken',   handleNewToken);
  potatoListener.on('newToken', handleNewToken);

  await ponsListener.start();
  await potatoListener.start();

  const subCount = db.count();
  logger.info('main', `✅ All listeners active — ${subCount} subscriber(s)`);
  logger.info('main', `📡 Polling Pons:    ${config.contracts.pons}`);
  logger.info('main', `🥔 Polling Potato:  ${config.contracts.potato}`);
  logger.info('main', `⏱  Poll interval:  ${config.polling.intervalMs}ms`);

  // Print shareable bot link
  try {
    const TelegramBot = require('node-telegram-bot-api');
    const tmp = new TelegramBot(config.telegram.token, { polling: false });
    const me = await tmp.getMe();
    if (me.username) logger.info('main', `👥 Bot link: https://t.me/${me.username}`);
  } catch { /* non-fatal */ }

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = (signal) => {
    logger.info('main', `${signal} received — shutting down…`);
    ponsListener.stop();
    potatoListener.stop();
    logger.info('main', 'Goodbye 👋');
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('main', 'Fatal error:', err.message);
  process.exit(1);
});
