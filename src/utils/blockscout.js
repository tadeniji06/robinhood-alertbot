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

// ── Block number ──────────────────────────────────────────────────────────────

/**
 * Returns the latest block number from Blockscout stats.
 * @returns {Promise<number>}
 */
async function getLatestBlock() {
  const { data } = await retry(
    () => http.get('/stats'),
    3, 1000, 'blockscout.getLatestBlock'
  );
  // total_blocks is the count; latest block index = count - 1, but
  // Blockscout returns total_blocks as the actual latest block number.
  return Number(data.total_blocks);
}

// ── Contract logs ─────────────────────────────────────────────────────────────

/**
 * Fetches the most recent logs for a contract address.
 * Blockscout returns logs newest-first; we filter to those after `afterBlock`.
 *
 * @param {string} address    - contract address
 * @param {number} afterBlock - only return logs with block_number > afterBlock
 * @returns {Promise<Array>}  - log items, ascending by block_number
 */
async function getNewLogs(address, afterBlock) {
  try {
    const { data } = await retry(
      () => http.get(`/addresses/${address}/logs`),
      3, 1000, `blockscout.getLogs.${address.slice(0, 8)}`
    );

    if (!data || !data.items) return [];

    // Filter to only new logs and sort ascending
    return data.items
      .filter((item) => Number(item.block_number) > afterBlock)
      .sort((a, b) => Number(a.block_number) - Number(b.block_number));
  } catch (err) {
    logger.warn('blockscout', `getLogs failed for ${address}: ${err.message}`);
    return [];
  }
}

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

module.exports = { getLatestBlock, getNewLogs, getTokenInfo, getCreatorTokenCount, getDevBalance, getEthPrice };

