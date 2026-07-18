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
  let totalSupply = 'Unknown';
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
      // Destroy provider immediately to avoid background polling
      if (provider.destroy) provider.destroy();
    } catch (rpcErr) {
      logger.warn('enricher', `RPC fallback failed: ${rpcErr.message}`);
    }
  }

  // ── 2. Format supply ─────────────────────────────────────────────────────
  let supplyFormatted = 'Unknown';
  try {
    const raw = BigInt(totalSupply);
    const formatted = ethers.formatUnits(raw, decimals);
    const num = parseFloat(formatted);
    supplyFormatted = isNaN(num)
      ? 'Unknown'
      : num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  } catch {
    supplyFormatted = 'Unknown';
  }

  // ── 3. Dev buy ────────────────────────────────────────────────────────────
  let devBuyAmount = null;
  let devBuyPct    = null;

  if (devBuyTokens && devBuyTokens !== '0') {
    try {
      const tokensNum = parseFloat(ethers.formatUnits(BigInt(devBuyTokens), decimals));
      devBuyAmount = tokensNum.toLocaleString('en-US', { maximumFractionDigits: 0 });
      const supplyNum = parseFloat(ethers.formatUnits(BigInt(totalSupply || '0'), decimals));
      if (supplyNum > 0) devBuyPct = ((tokensNum / supplyNum) * 100).toFixed(2);
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

  // ── 4. Creator previous token count ──────────────────────────────────────
  const prevTokenCount = await blockscout.getCreatorTokenCount(creatorAddress);

  // ── 5. Format date/time ──────────────────────────────────────────────────
  const dt = new Date(timestamp);
  const dateFormatted = dt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  const timeFormatted = dt.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'UTC', hour12: false,
  });

  return {
    tokenAddress,
    creatorAddress,
    txHash,
    timestamp,
    dateFormatted,
    timeFormatted,
    launchpad,
    name:         name    || 'Unknown',
    symbol:       symbol  || '???',
    totalSupply:  supplyFormatted,
    decimals,
    devBuyAmount,
    devBuyPct,
    prevTokenCount,
    imageURI:  imageURI  || null,
    website:   website   || null,
    twitter:   twitter   || null,
    telegram:  telegram  || null,
  };
}

module.exports = { enrichToken };
