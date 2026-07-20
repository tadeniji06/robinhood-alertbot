'use strict';

/**
 * test-alert.js
 *
 * Sends a realistic fake token alert through the full pipeline
 * (formatter → Telegram broadcast) to verify the bot is working.
 *
 * Usage:
 *   node scripts/test-alert.js             → tests Pons alert
 *   node scripts/test-alert.js potato      → tests Potato Pad alert
 *   node scripts/test-alert.js both        → tests both back-to-back
 */

require('dotenv').config();

const { formatAlert }    = require('../src/formatters/alertFormatter');
const telegramBot        = require('../src/bot/telegramBot');
const db                 = require('../src/db/subscribers');
const logger             = require('../src/utils/logger');

// ── Mock token data ───────────────────────────────────────────────────────────

const MOCK_PONS = {
  tokenAddress:   '0x967191771f912Ace4139169b3d3961EBCA1Aa354',
  creatorAddress: '0x4e4d758A3B33bF75a6A7CF9BB6caC2C3067a4875',
  txHash:         '0x2b53cbdebd12269240a56588b2cf784e36abf874d95428d1965b490208fbcc99',
  timestamp:      new Date().toISOString(),
  dateFormatted:  new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
  timeFormatted:  new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }),
  launchpad:      'Pons',
  name:           'Test Moon Coin',
  symbol:         'TMOON',
  description:    null,
  totalSupply:    '1,000,000,000',
  decimals:       18,
  devBuyAmount:   '0.2000 ETH',
  devBuyPct:      null,
  tokenPriceEth:  0.00000000021,
  marketCapEth:   0.21,
  marketCapUsd:   396.78,
  ethPriceUsd:    1889.43,
  devBalance:     '2.4500 ETH',
  prevTokenCount: 2,
  imageURI:       null,
  website:        'https://example.com',
  twitter:        'https://x.com/testmoon',
  telegram:       'https://t.me/testmoon',
};

const MOCK_PEW = {
  tokenAddress:   '0x04f8a02CB4dA475827fC6d39B31cf55018CEc425',
  creatorAddress: '0x52F8e3D351f0bA2071119311A7769FCd9f9AE7d8',
  txHash:         '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  timestamp:      new Date().toISOString(),
  dateFormatted:  new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
  timeFormatted:  new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }),
  launchpad:      'Pew.fun',
  name:           'Alux Ushi',
  symbol:         'ALUX',
  description:    'The legendary Alux from Mayan folklore, now on Robinhood Chain. A mischievous creature guarding hidden treasures.',
  totalSupply:    '1,000,000,000',
  decimals:       18,
  devBuyAmount:   null,
  devBuyPct:      null,
  tokenPriceEth:  null,
  marketCapEth:   null,
  marketCapUsd:   null,
  ethPriceUsd:    1889.43,
  devBalance:     '3.1415 ETH',
  prevTokenCount: 0,
  imageURI:       null,
  website:        null,
  twitter:        'https://x.com/aluxushi',
  telegram:       null,
};
const MOCK_POTATO = {
  tokenAddress:   '0x1e4d3243a287EDb687A4cBf2A1223dA54E8c835f',
  creatorAddress: '0x400bbdaA30D4AE46dcF9bf123e8256fdb4dC36Ba',
  txHash:         '0x31905222ccd2a32accd306d295e0d2cd5979cb11ca2aa5234b6b71fb95b6306d',
  timestamp:      new Date().toISOString(),
  dateFormatted:  new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
  timeFormatted:  new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }),
  launchpad:      'Potato Pad',
  name:           'Chip',
  symbol:         'CHIP',
  description:    null,
  totalSupply:    '999,999,999',
  decimals:       18,
  devBuyAmount:   '16,162,210',
  devBuyPct:      '1.62',
  // price = 0.05 ETH / 16,162,210 tokens
  tokenPriceEth:  0.05 / 16162210,
  marketCapEth:   (0.05 / 16162210) * 999999999,
  marketCapUsd:   (0.05 / 16162210) * 999999999 * 1889.43,
  ethPriceUsd:    1889.43,
  devBalance:     '0.0500 ETH',
  prevTokenCount: 0,
  imageURI:       'ipfs://QmZCSUufjazNbdwKtbZVPyY1dFshqoAnMuajQys6ub3sp9',
  website:        null,
  twitter:        null,
  telegram:       null,
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const arg = process.argv[2] || 'pons';

  const subCount = db.count();
  if (subCount === 0) {
    logger.warn('test', '⚠️  No subscribers found!');
    logger.warn('test', '   Start the bot with `npm start`, then DM it /start on Telegram first.');
    logger.warn('test', '   Then re-run this script.');
    process.exit(1);
  }

  logger.info('test', `📋 Found ${subCount} subscriber(s)`);

  telegramBot.init();

  const tests = [];
  if (arg === 'all') {
    tests.push(MOCK_PONS, MOCK_POTATO, MOCK_PEW);
  } else if (arg === 'both') {
    tests.push(MOCK_PONS, MOCK_POTATO);
  } else if (arg === 'potato') {
    tests.push(MOCK_POTATO);
  } else if (arg === 'pew') {
    tests.push(MOCK_PEW);
  } else {
    tests.push(MOCK_PONS);
  }

  for (const mockToken of tests) {
    logger.info('test', `🔔 Sending ${mockToken.launchpad} test alert…`);
    const message = formatAlert(mockToken);

    // Print the formatted message to terminal too
    console.log('\n' + '─'.repeat(60));
    console.log('FORMATTED MESSAGE PREVIEW:');
    console.log('─'.repeat(60));
    console.log(message.replace(/<[^>]+>/g, ''));  // strip HTML for terminal
    console.log('─'.repeat(60) + '\n');

    const { sent, failed } = await telegramBot.broadcastAlert(message, mockToken.imageURI, mockToken.launchpad);
    logger.info('test', `✅ Done — sent: ${sent}, failed: ${failed}`);

    if (tests.length > 1) {
      // Small pause between the two alerts
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  logger.info('test', '🎉 Test complete! Check your Telegram.');
  process.exit(0);
}

run().catch((err) => {
  logger.error('test', 'Test failed:', err.message);
  process.exit(1);
});
