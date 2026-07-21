'use strict';

const { EventEmitter } = require('events');
const blockscout = require('../utils/blockscout');
const logger     = require('../utils/logger');
const { sleep }  = require('../utils/retry');
const config     = require('../config');

// ── Event topic to filter for ─────────────────────────────────────────────────
// TokenLaunched — emitted by Pons factory when a token is fully live
// topic0: 0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a
const TOKEN_LAUNCHED_TOPIC =
  '0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a';

class PonsListener extends EventEmitter {
  constructor(provider) {
    super();
    this.provider = provider;
    this.lastBlock  = 0;
    this._running   = false;
    this._seenTxHashes = new Set();
  }

  async start() {
    this._running = true;
    logger.info('PonsListener', `Starting Blockscout polling for ${config.contracts.pons}`);

    // Initialise lastBlock to current tip so we only alert on NEW tokens
    while (!this.lastBlock) {
      try {
        this.lastBlock = await this.provider.getBlockNumber();
        logger.info('PonsListener', `✅ Ready — polling from block ${this.lastBlock}`);
      } catch (err) {
        logger.warn('PonsListener', `Could not get latest block (${err.message}), retrying in 5s...`);
        await sleep(5000);
      }
    }

    this._poll();
  }

  async _poll() {
    while (this._running) {
      await sleep(config.polling.intervalMs);
      try {
        await this._check();
      } catch (err) {
        logger.error('PonsListener', 'Poll cycle error:', err.message);
      }
    }
  }

  async _check() {
    let latestBlock;
    try {
      latestBlock = await this.provider.getBlockNumber();
    } catch (e) {
      logger.warn('PonsListener', `RPC getBlockNumber failed: ${e.message}`);
      return;
    }

    if (latestBlock <= this.lastBlock) return;

    // Fetch logs directly via RPC, filtering strictly for TokenLaunched to bypass all limits
    let logs;
    try {
      logs = await this.provider.getLogs({
        address: config.contracts.pons,
        topics: [TOKEN_LAUNCHED_TOPIC],
        fromBlock: this.lastBlock + 1,
        toBlock: latestBlock
      });
    } catch (err) {
      logger.warn('PonsListener', `RPC getLogs failed: ${err.message}`);
      return;
    }

    // Update watermark even if no logs, so we don't scan the same empty blocks forever
    this.lastBlock = latestBlock;

    if (!logs.length) return;

    for (const log of logs) {
      const txHash = log.transactionHash;
      if (!txHash || this._seenTxHashes.has(txHash)) continue;
      this._seenTxHashes.add(txHash);
      if (this._seenTxHashes.size > 500) {
        this._seenTxHashes.delete(this._seenTxHashes.values().next().value);
      }

      // Since we bypassed Blockscout, decode the RPC log data manually
      const tokenAddress   = '0x' + log.topics[1].slice(26);
      const creatorAddress = '0x' + log.topics[2].slice(26);

      // The unindexed data is initialBuyAmount (uint256)
      const initialBuyAmt = BigInt(log.data || '0x0').toString();

      if (!tokenAddress) continue;

      logger.info('PonsListener', `🆕 Token launched: ${tokenAddress} | deployer: ${creatorAddress}`);

      this.emit('newToken', {
        tokenAddress,
        creatorAddress,
        txHash,
        timestamp:         new Date().toISOString(), // Fallback for RPC
        launchpad:         'Pons',
        initialBuyAmount:  initialBuyAmt,
      });
    }
  }

  stop() {
    this._running = false;
    logger.info('PonsListener', 'Stopped.');
  }
}

module.exports = PonsListener;
