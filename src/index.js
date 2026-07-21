'use strict';

require('dotenv').config();

const config         = require('./config');
const { ethers }     = require('ethers');
const PonsListener   = require('./listeners/ponsListener');
const PotatoListener = require('./listeners/potatoListener');
const PewListener    = require('./listeners/pewListener');
const { enrichToken }  = require('./enrichers/tokenEnricher');
const { formatAlert }  = require('./formatters/alertFormatter');
const telegramBot      = require('./bot/telegramBot');
const logger           = require('./utils/logger');
const db               = require('./db/subscribers');

// ── Event pipeline ────────────────────────────────────────────────────────────

async function handleNewToken(rawToken) {
  try {
    logger.info('main', `🔔 New token: ${rawToken.tokenAddress} (${rawToken.launchpad})`);
    // No provider passed — enricher uses Blockscout API only
    const enriched = await enrichToken(rawToken);
    const message  = formatAlert(enriched);
    await telegramBot.broadcastAlert(message, enriched.imageURI, rawToken.launchpad);
  } catch (err) {
    logger.error('main', `Failed to process token ${rawToken.tokenAddress}:`, err.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('main', '🚀 Robinhood Alert Bot starting…');
  logger.info('main', `Chain ID: ${config.rpc.chainId}`);

  // Create primary blockchain provider
  const provider = new ethers.JsonRpcProvider(config.rpc.url, undefined, {
    staticNetwork: true,
    polling: false,
  });

  // Verify RPC is reachable and wait for network if DNS is temporarily down
  let latestBlock = null;
  const { sleep } = require('./utils/retry');
  while (latestBlock === null) {
    try {
      latestBlock = await provider.getBlockNumber();
      logger.info('main', `✅ RPC connected — latest block: ${latestBlock}`);
    } catch (err) {
      logger.error('main', `RPC connection failed (${err.message}), retrying in 5s...`);
      await sleep(5000);
    }
  }

  // Start interactive Telegram bot (polling for /start, /stop, /stats)
  telegramBot.init(db);

  // ── Listeners ───────────────────────────────────────────────────────────────
  const pons   = new PonsListener(provider);
  const potato = new PotatoListener(provider);
  const pew    = new PewListener(provider);

  pons.on('newToken',   handleNewToken);
  potato.on('newToken', handleNewToken);
  pew.on('newToken',    handleNewToken);

  await pons.start();
  await potato.start();
  await pew.start();

  const subCount = db.count();
  logger.info('main', `✅ All listeners active — ${subCount} subscriber(s)`);
  logger.info('main', `📡 Polling Pons:    ${config.contracts.pons}`);
  logger.info('main', `🥔 Polling Potato:  ${config.contracts.potato}`);
  logger.info('main', `🎯 Polling Pew:     ${config.contracts.pew}`);
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
    pewListener.stop();
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
