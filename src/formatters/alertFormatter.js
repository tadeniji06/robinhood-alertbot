'use strict';

const EXPLORER = 'https://robinhoodchain.blockscout.com';

function shortAddr(addr) {
  if (!addr) return 'Unknown';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtEth(val, decimals = 8) {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  if (isNaN(n)) return null;
  if (n < 0.000001 && n > 0) {
    return n.toExponential(4) + ' ETH';
  }
  return n.toFixed(decimals).replace(/\.?0+$/, '') + ' ETH';
}

function fmtUsd(val) {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  if (isNaN(n)) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function buildHeader(launchpad) {
  return `🚀 <b>New Token on ${esc(launchpad)}</b> 🚀`;
}

function buildSocials(token) {
  const parts = [];
  if (token.twitter)  parts.push(`<a href="${esc(token.twitter)}">Twitter</a>`);
  if (token.telegram) parts.push(`<a href="${esc(token.telegram)}">Telegram</a>`);
  if (token.website)  parts.push(`<a href="${esc(token.website)}">Website</a>`);
  return parts.length > 0 ? parts.join(' | ') : 'None';
}

function buildTradeLink(token) {
  if (token.launchpad === 'Pons') {
    return `<a href="https://pons.family/launchpad/${token.tokenAddress}">Trade $${esc(token.symbol)} on Pons ↗️</a>`;
  }
  if (token.launchpad === 'Potato Pad') {
    return `<a href="https://potato.fm/token/${token.tokenAddress}">Trade $${esc(token.symbol)} on Potato Pad ↗️</a>`;
  }
  return `<a href="https://pew.fun/token/${token.tokenAddress}">Trade $${esc(token.symbol)} on Pew.fun ↗️</a>`;
}

/**
 * Formats an enriched token object into a Telegram HTML alert message.
 * Matches requested "MemeJob" screenshot layout structure.
 *
 * @param {Object} token
 * @returns {string}
 */
function formatAlert(token) {
  const creatorShort    = shortAddr(token.creatorAddress);
  const creatorExplorer = `${EXPLORER}/address/${token.creatorAddress}`;

  // ── Price & Market Cap ────────────────────────────────────────────────────
  const priceEthStr = fmtEth(token.tokenPriceEth, 10);
  const mcapEthStr  = fmtEth(token.marketCapEth, 4);
  const mcapUsdStr  = fmtUsd(token.marketCapUsd);

  // ── Details Section ───────────────────────────────────────────────────────
  const details = [
    `<b>Details</b>`,
    `├─ 🏛 <b>Name:</b> ${esc(token.name)}`,
    `├─ 🆔 <b>Token CA:</b> <code>${token.tokenAddress}</code>`,
    `├─ 💲 <b>Symbol:</b> $${esc(token.symbol)}`,
    `├─ 📦 <b>Supply:</b> ${esc(token.totalSupply)}`
  ];

  if (priceEthStr) {
    details.push(`├─ 📈 <b>Price:</b> ${priceEthStr}${token.ethPriceUsd ? ` (~$${(token.tokenPriceEth * token.ethPriceUsd).toFixed(8)})` : ''}`);
  }

  if (mcapEthStr || mcapUsdStr) {
    const parts = [];
    if (mcapEthStr) parts.push(mcapEthStr);
    if (mcapUsdStr) parts.push(mcapUsdStr);
    details.push(`├─ 💹 <b>Market Cap:</b> ${parts.join(' · ')}`);
  }

  if (token.description) {
    details.push(`└─ 📄 <b>Description 👇</b>`);
    details.push(``);
    details.push(`<i>${esc(token.description.slice(0, 300))}${token.description.length > 300 ? '…' : ''}</i>`);
  } else {
    // If no description, replace last pipe with bottom corner
    details[details.length - 1] = details[details.length - 1].replace('├─', '└─');
  }

  // ── Creator Section ───────────────────────────────────────────────────────
  const creatorInfo = [
    `<b>Creator Info</b>`,
    `├─ 🏦 <b>Owner:</b> <a href="${creatorExplorer}">${creatorShort}</a>`
  ];

  if (token.devBuyAmount) {
    creatorInfo.push(`├─ 🪙 <b>Dev Buy:</b> ${esc(token.devBuyAmount)}${token.devBuyPct ? ` (${token.devBuyPct}%)` : ''}`);
  } else {
    creatorInfo.push(`├─ 🪙 <b>Dev Buy:</b> None`);
  }

  if (token.devBalance) {
    creatorInfo.push(`├─ 💰 <b>ETH Balance:</b> ${esc(token.devBalance)}`);
  }

  const prevTokensStr = token.prevTokenCount > 0
    ? `${token.prevTokenCount} other token(s)`
    : `First token`;
  
  creatorInfo.push(`├─ 🔁 <b>Prev Tokens:</b> ${prevTokensStr}`);
  creatorInfo.push(`└─ 👥 <b>Social:</b> ${buildSocials(token)}`);

  // ── Combine All ───────────────────────────────────────────────────────────
  const lines = [
    buildHeader(token.launchpad),
    '',
    ...details,
    '',
    ...creatorInfo,
    '',
    `├─ 🏬 <b>${buildTradeLink(token)}</b>`,
    '',
    `<i>⚠️ DYOR — Not financial advice.</i>`
  ];

  return lines.join('\n');
}

module.exports = { formatAlert };
