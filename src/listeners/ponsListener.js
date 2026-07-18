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
  constructor() {
    super();
    this.lastBlock  = 0;
    this._running   = false;
    this._seenTxHashes = new Set();
  }

  async start() {
    this._running = true;
    logger.info('PonsListener', `Starting Blockscout polling for ${config.contracts.pons}`);

    // Initialise lastBlock to current tip so we only alert on NEW tokens
    try {
      this.lastBlock = await blockscout.getLatestBlock();
      logger.info('PonsListener', `✅ Ready — polling from block ${this.lastBlock}`);
    } catch (err) {
      logger.warn('PonsListener', 'Could not get latest block, starting from 0:', err.message);
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
    const logs = await blockscout.getNewLogs(config.contracts.pons, this.lastBlock);
    if (!logs.length) return;

    for (const log of logs) {
      // Update watermark
      if (Number(log.block_number) > this.lastBlock) {
        this.lastBlock = Number(log.block_number);
      }

      // Only process TokenLaunched events
      if (!log.topics || log.topics[0] !== TOKEN_LAUNCHED_TOPIC) continue;

      const txHash = log.transaction_hash;
      if (!txHash || this._seenTxHashes.has(txHash)) continue;
      this._seenTxHashes.add(txHash);
      if (this._seenTxHashes.size > 500) {
        this._seenTxHashes.delete(this._seenTxHashes.values().next().value);
      }

      // Extract from decoded Blockscout data
      const decoded = log.decoded;
      if (!decoded) continue;

      const params = {};
      for (const p of decoded.parameters || []) params[p.name] = p.value;

      const tokenAddress   = params.token    || log.topics[1]?.replace('0x000000000000000000000000', '0x');
      const creatorAddress = params.deployer  || log.topics[2]?.replace('0x000000000000000000000000', '0x');
      const initialBuyAmt  = params.initialBuyAmount || '0';

      if (!tokenAddress) continue;

      logger.info('PonsListener', `🆕 Token launched: ${tokenAddress} | deployer: ${creatorAddress}`);

      this.emit('newToken', {
        tokenAddress,
        creatorAddress,
        txHash,
        timestamp:         log.block_timestamp || new Date().toISOString(),
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
