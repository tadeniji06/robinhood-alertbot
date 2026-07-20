'use strict';

const { ethers }  = require('ethers');
const blockscout  = require('../utils/blockscout');
const logger      = require('../utils/logger');
const config      = require('../config');

/**
 * Enriches a raw token event with full metadata.
 * Primary source: Blockscout API (no RPC calls needed).
 * Fallback: ethers direct contract call (only if Blockscout lacks the data).
 */
async function enrichToken(params) {
  const {
    tokenAddress,
    creatorAddress,
    txHash,
    timestamp,
    launchpad,
    name: eventName,
    symbol: eventSymbol,
    description: eventDesc,
    imageURI,
    website,
    twitter,
    telegram,
    devBuyEth,
    devBuyTokens,
    initialBuyAmount,
  } = params;

  logger.info('enricher', `Enriching ${tokenAddress} (${launchpad})`);

  // ── 1. Token metadata — Blockscout first ─────────────────────────────────
  let name        = eventName  || null;
  let symbol      = eventSymbol || null;
  let totalSupply = '0';
  let decimals    = 18;

  const bsToken = await blockscout.getTokenInfo(tokenAddress);
  if (bsToken) {
    name        = name   || bsToken.name;
    symbol      = symbol || bsToken.symbol;
    decimals    = bsToken.decimals;
    totalSupply = bsToken.totalSupply;
  }

  // ── Fallback: direct RPC call if Blockscout didn't index yet ─────────────
  if ((!name || name === 'Unknown') && config.rpc.url) {
    try {
      const provider = new ethers.JsonRpcProvider(config.rpc.url, undefined, {
        staticNetwork: true,
        polling: false,
      });
      const ERC20_ABI = [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function totalSupply() view returns (uint256)',
        'function decimals() view returns (uint8)',
      ];
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const [rawName, rawSymbol, rawSupply, rawDecimals] = await Promise.all([
        contract.name(), contract.symbol(), contract.totalSupply(), contract.decimals(),
      ]);
      name        = name || rawName;
      symbol      = symbol || rawSymbol;
      decimals    = Number(rawDecimals);
      totalSupply = rawSupply.toString();
      if (provider.destroy) provider.destroy();
    } catch (rpcErr) {
      logger.warn('enricher', `RPC fallback failed: ${rpcErr.message}`);
    }
  }

  // ── 2. Format supply ─────────────────────────────────────────────────────
  let supplyRaw       = BigInt(0);
  let supplyFormatted = 'Unknown';
  try {
    supplyRaw = BigInt(totalSupply);
    const formatted = ethers.formatUnits(supplyRaw, decimals);
    const num = parseFloat(formatted);
    supplyFormatted = isNaN(num)
      ? 'Unknown'
      : num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  } catch {
    supplyFormatted = 'Unknown';
  }

  // ── 3. Dev buy + price calculation ───────────────────────────────────────
  let devBuyAmount   = null;
  let devBuyPct      = null;
  let tokenPriceEth  = null;   // price per 1 token in ETH
  let supplyNum      = 0;

  try { supplyNum = parseFloat(ethers.formatUnits(supplyRaw, decimals)); } catch {}

  if (devBuyTokens && devBuyTokens !== '0') {
    try {
      const tokensNum  = parseFloat(ethers.formatUnits(BigInt(devBuyTokens), decimals));
      const ethNum     = parseFloat(ethers.formatEther(BigInt(devBuyEth || '0')));
      devBuyAmount = tokensNum.toLocaleString('en-US', { maximumFractionDigits: 0 });
      if (supplyNum > 0) devBuyPct = ((tokensNum / supplyNum) * 100).toFixed(2);
      // Initial price = ETH spent / tokens received
      if (tokensNum > 0 && ethNum > 0) tokenPriceEth = ethNum / tokensNum;
    } catch {
      devBuyAmount = devBuyTokens;
    }
  } else if (initialBuyAmount && initialBuyAmount !== '0') {
    try {
      const ethSpent = parseFloat(ethers.formatEther(BigInt(initialBuyAmount)));
      if (ethSpent > 0) devBuyAmount = `${ethSpent.toFixed(4)} ETH`;
    } catch {
      devBuyAmount = null;
    }
  }

  // ── 4. Market cap ─────────────────────────────────────────────────────────
  let marketCapEth = null;
  let marketCapUsd = null;

  if (tokenPriceEth !== null && supplyNum > 0) {
    marketCapEth = tokenPriceEth * supplyNum;
  }

  // ── 5. Creator info (parallel) ────────────────────────────────────────────
  const [prevTokenCount, devBalance, ethPriceUsd] = await Promise.all([
    blockscout.getCreatorTokenCount(creatorAddress),
    blockscout.getDevBalance(creatorAddress),
    blockscout.getEthPrice(),
  ]);

  if (marketCapEth !== null && ethPriceUsd) {
    marketCapUsd = marketCapEth * ethPriceUsd;
  }

  // ── 6. Format date/time ──────────────────────────────────────────────────
  const dt = new Date(timestamp);
  const dateFormatted = dt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  const timeFormatted = dt.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'UTC', hour12: false,
  });
  let finalImageURI = imageURI || (bsToken ? bsToken.icon_url : null) || null;
  if (!finalImageURI) {
    if (launchpad === 'Pons') {
      finalImageURI = 'https://www.google.com/s2/favicons?sz=256&domain_url=https://pons.family';
    } else if (launchpad === 'Potato Pad') {
      finalImageURI = 'https://www.google.com/s2/favicons?sz=256&domain_url=https://potato.fm';
    } else if (launchpad === 'Pew.fun') {
      finalImageURI = 'https://www.google.com/s2/favicons?sz=256&domain_url=https://pew.fun';
    }
  }

  return {
    tokenAddress,
    creatorAddress,
    txHash,
    timestamp,
    dateFormatted,
    timeFormatted,
    launchpad,
    name:          name    || 'Unknown',
    symbol:        symbol  || '???',
    description:   eventDesc || null,
    totalSupply:   supplyFormatted,
    decimals,
    devBuyAmount,
    devBuyPct,
    tokenPriceEth,
    marketCapEth,
    marketCapUsd,
    ethPriceUsd,
    prevTokenCount,
    devBalance:    devBalance || null,
    imageURI:      finalImageURI,
    website:       website   || null,
    twitter:       twitter   || null,
    telegram:      telegram  || null,
  };
}

module.exports = { enrichToken };
