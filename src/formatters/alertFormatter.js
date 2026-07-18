'use strict';

const config = require('../config');

const EXPLORER = 'https://robinhoodchain.blockscout.com';

/**
 * Truncates an Ethereum address for display.
 * @param {string} addr
 * @returns {string} e.g. 0x1234...5678
 */
function shortAddr(addr) {
  if (!addr) return 'Unknown';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Escapes characters that have special meaning in Telegram HTML mode.
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Builds the launchpad-specific branding header.
 */
function buildHeader(launchpad) {
  if (launchpad === 'Pons') {
    return `🌉 <b>New Token on Pons</b> 🌉`;
  }
  return `🥔 <b>New Token on Potato Pad</b> 🥔`;
}

/**
 * Builds the socials line.
 */
function buildSocials(token) {
  const parts = [];
  if (token.twitter)  parts.push(`<a href="${esc(token.twitter)}">𝕏 Twitter</a>`);
  if (token.telegram) parts.push(`<a href="${esc(token.telegram)}">✈️ Telegram</a>`);
  if (token.website)  parts.push(`<a href="${esc(token.website)}">🌐 Website</a>`);
  return parts.length > 0 ? parts.join('  |  ') : 'None';
}

/**
 * Builds the launchpad trade link.
 */
function buildTradeLink(token) {
  if (token.launchpad === 'Pons') {
    return `<a href="https://pons.family/launchpad/${token.tokenAddress}">Trade $${esc(token.symbol)} on Pons</a>`;
  }
  return `<a href="https://potato.fm/token/${token.tokenAddress}">Trade $${esc(token.symbol)} on Potato Pad</a>`;
}

/**
 * Formats an enriched token object into a Telegram HTML alert message.
 *
 * @param {Object} token - enriched token data from tokenEnricher
 * @returns {string} Telegram HTML message
 */
function formatAlert(token) {
  const creatorShort = shortAddr(token.creatorAddress);
  const creatorExplorerUrl = `${EXPLORER}/address/${token.creatorAddress}`;
  const tokenExplorerUrl   = `${EXPLORER}/token/${token.tokenAddress}`;
  const txExplorerUrl      = `${EXPLORER}/tx/${token.txHash}`;

  // Dev buy line
  let devBuyLine;
  if (token.devBuyAmount) {
    devBuyLine = `💰 <b>Dev Buy:</b> ${esc(token.devBuyAmount)}${token.devBuyPct ? ` (${token.devBuyPct}% of supply)` : ''}`;
  } else {
    devBuyLine = `💰 <b>Dev Buy:</b> None detected`;
  }

  // Previous tokens line
  const prevLine = token.prevTokenCount > 0
    ? `🔁 <b>Prev Tokens by Creator:</b> ${token.prevTokenCount}`
    : `🆕 <b>Creator:</b> First token launched`;

  const divider = '━━━━━━━━━━━━━━━━━━━';

  const message = [
    buildHeader(token.launchpad),
    divider,
    '',
    `📋 <b>Token Details</b>`,
    `├─ 🏷  <b>Name:</b> ${esc(token.name)} (<code>$${esc(token.symbol)}</code>)`,
    `├─ 📅 <b>Created:</b> ${esc(token.dateFormatted)} · ${esc(token.timeFormatted)} UTC`,
    `├─ 🏗  <b>Launchpad:</b> ${esc(token.launchpad)}`,
    `└─ 📦 <b>Total Supply:</b> ${esc(token.totalSupply)}`,
    '',
    `👤 <b>Creator Info</b>`,
    `├─ 🔑 <b>Address:</b> <a href="${creatorExplorerUrl}">${creatorShort}</a>`,
    `├─ ${devBuyLine}`,
    `└─ ${prevLine}`,
    '',
    `🌐 <b>Socials</b>`,
    `└─ ${buildSocials(token)}`,
    '',
    `🔗 <b>Links</b>`,
    `├─ 📊 <a href="${tokenExplorerUrl}">View Token on Explorer</a>`,
    `├─ 🧾 <a href="${txExplorerUrl}">View Launch Tx</a>`,
    `└─ 💱 ${buildTradeLink(token)}`,
    '',
    divider,
    `<i>⚠️ DYOR — Not financial advice.</i>`,
  ].join('\n');

  return message;
}

module.exports = { formatAlert };
