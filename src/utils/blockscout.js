'use strict';

const axios  = require('axios');
const config = require('../config');
const logger = require('./logger');
const { retry, sleep } = require('./retry');

const BASE = config.blockscout.apiUrl;

// Shared axios instance with sensible defaults
const http = axios.create({
  baseURL: BASE,
  timeout: 10_000,
  headers: { 'Accept': 'application/json' },
});



// ── Token info ────────────────────────────────────────────────────────────────

/**
 * Fetches full token metadata from Blockscout (1 API call, no RPC needed).
 * Retries a few times because newly-created tokens may not be indexed yet.
 *
 * @param {string} tokenAddress
 * @returns {Promise<{name, symbol, totalSupply, decimals}|null>}
 */
async function getTokenInfo(tokenAddress) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const { data } = await http.get(`/tokens/${tokenAddress}`);
      if (data && data.symbol) {
        return {
          name:        data.name        || 'Unknown',
          symbol:      data.symbol      || '???',
          totalSupply: data.total_supply || '0',
          decimals:    data.decimals     ? Number(data.decimals) : 18,
          icon_url:    data.icon_url     || null,
        };
      }
    } catch (err) {
      // 404 means not indexed yet — wait and retry
      if (err?.response?.status === 404) {
        logger.debug('blockscout', `Token ${tokenAddress} not indexed yet (attempt ${attempt}/5)`);
        await sleep(3000 * attempt);
        continue;
      }
      logger.warn('blockscout', `getTokenInfo failed: ${err.message}`);
      return null;
    }
    await sleep(3000 * attempt);
  }
  return null;
}

// ── Creator history ───────────────────────────────────────────────────────────

/**
 * Counts how many contract deployments a creator wallet has made.
 * Uses Blockscout's transaction list and counts null-`to` txs (contract creations).
 *
 * @param {string} creatorAddress
 * @returns {Promise<number>}
 */
async function getCreatorTokenCount(creatorAddress) {
  try {
    const { data } = await retry(
      () => http.get(`/addresses/${creatorAddress}/transactions`),
      3, 1000, 'blockscout.creatorCount'
    );
    if (!data?.items) return 0;
    return data.items.filter((tx) => tx.to === null && tx.status === 'ok').length;
  } catch (err) {
    logger.warn('blockscout', `creatorTokenCount failed: ${err.message}`);
    return 0;
  }
}

/**
 * Fetches the native coin (ETH) balance of a wallet address.
 * @param {string} address
 * @returns {Promise<string|null>} formatted balance string e.g. "1.2345 ETH"
 */
async function getDevBalance(address) {
  try {
    const { data } = await retry(
      () => http.get(`/addresses/${address}`),
      2, 500, 'blockscout.devBalance'
    );
    if (data && data.coin_balance) {
      const { ethers } = require('ethers');
      const formatted = parseFloat(ethers.formatEther(data.coin_balance));
      return `${formatted.toFixed(4)} ETH`;
    }
    return null;
  } catch (err) {
    logger.warn('blockscout', `getDevBalance failed for ${address}: ${err.message}`);
    return null;
  }
}

/**
 * Fetches the current ETH/USD price from Blockscout stats.
 * @returns {Promise<number|null>} price in USD, or null if unavailable
 */
async function getEthPrice() {
  try {
    const { data } = await retry(
      () => http.get('/stats'),
      2, 500, 'blockscout.ethPrice'
    );
    const price = parseFloat(data?.coin_price);
    return isNaN(price) ? null : price;
  } catch (err) {
    logger.warn('blockscout', `getEthPrice failed: ${err.message}`);
    return null;
  }
}

module.exports = { getTokenInfo, getCreatorTokenCount, getDevBalance, getEthPrice };
