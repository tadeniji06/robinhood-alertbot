'use strict';

const { EventEmitter } = require('events');
const blockscout = require('../utils/blockscout');
const logger     = require('../utils/logger');
const { sleep }  = require('../utils/retry');
const config     = require('../config');

// ── Event topics ──────────────────────────────────────────────────────────────
// TokenCreated — includes name, symbol, socials inline
const TOKEN_CREATED_TOPIC =
  '0x875522b092d9e19a1de359e4bd218090d582fa521c9733889acf1a5ff1941255';
// DevBuy — emitted in the same tx when creator buys at launch
const DEV_BUY_TOPIC =
  '0x84d429ed8af1c9cfe8bb07b556e4120e976c9f4c9232a7f50a15d31d83e232a9';

class PotatoListener extends EventEmitter {
  constructor() {
    super();
    this.lastBlock  = 0;
    this._running   = false;
    this._seenTxHashes = new Set();
    // txHash → { ethIn, tokensOut } — correlate DevBuy with TokenCreated
    this._devBuyCache = new Map();
  }

  async start() {
    this._running = true;
    logger.info('PotatoListener', `Starting Blockscout polling for ${config.contracts.potato}`);

    try {
      this.lastBlock = await blockscout.getLatestBlock();
      logger.info('PotatoListener', `✅ Ready — polling from block ${this.lastBlock}`);
    } catch (err) {
      logger.warn('PotatoListener', 'Could not get latest block, starting from 0:', err.message);
    }

    this._poll();
  }

  async _poll() {
    while (this._running) {
      await sleep(config.polling.intervalMs);
      try {
        await this._check();
      } catch (err) {
        logger.error('PotatoListener', 'Poll cycle error:', err.message);
      }
    }
  }

  async _check() {
    const logs = await blockscout.getNewLogs(config.contracts.potato, this.lastBlock);
    if (!logs.length) return;

    // ── Pass 1: collect DevBuy events into cache ───────────────────────────
    for (const log of logs) {
      if (!log.topics || log.topics[0] !== DEV_BUY_TOPIC) continue;
      const decoded = log.decoded;
      if (!decoded) continue;
      const params = {};
      for (const p of decoded.parameters || []) params[p.name] = p.value;
      if (log.transaction_hash && params.ethIn) {
        this._devBuyCache.set(log.transaction_hash, {
          ethIn:     params.ethIn,
          tokensOut: params.tokensOut,
        });
      }
    }

    // ── Pass 2: process TokenCreated events ───────────────────────────────
    for (const log of logs) {
      if (Number(log.block_number) > this.lastBlock) {
        this.lastBlock = Number(log.block_number);
      }

      if (!log.topics || log.topics[0] !== TOKEN_CREATED_TOPIC) continue;

      const txHash = log.transaction_hash;
      if (!txHash || this._seenTxHashes.has(txHash)) continue;
      this._seenTxHashes.add(txHash);
      if (this._seenTxHashes.size > 500) {
        this._seenTxHashes.delete(this._seenTxHashes.values().next().value);
      }

      const decoded = log.decoded;
      if (!decoded) continue;

      const params = {};
      for (const p of decoded.parameters || []) params[p.name] = p.value;

      const tokenAddress   = params.token   || log.topics[1]?.replace('0x000000000000000000000000', '0x');
      const creatorAddress = params.creator  || log.topics[2]?.replace('0x000000000000000000000000', '0x');

      if (!tokenAddress) continue;

      // Pull DevBuy data if we captured it
      const devBuy = this._devBuyCache.get(txHash);
      if (devBuy) this._devBuyCache.delete(txHash);

      logger.info('PotatoListener', `🥔 Token created: ${params.symbol || '?'} (${tokenAddress})`);

      this.emit('newToken', {
        tokenAddress,
        creatorAddress,
        txHash,
        timestamp:    log.block_timestamp || new Date().toISOString(),
        launchpad:    'Potato Pad',
        name:         params.name     || null,
        symbol:       params.symbol   || null,
        imageURI:     params.imageURI || null,
        website:      params.website  || null,
        twitter:      params.twitter  || null,
        telegram:     params.telegram || null,
        devBuyEth:    devBuy?.ethIn    || null,
        devBuyTokens: devBuy?.tokensOut || null,
      });
    }

    // Clean up stale devBuy cache entries (>2 min old)
    if (this._devBuyCache.size > 100) this._devBuyCache.clear();
  }

  stop() {
    this._running = false;
    logger.info('PotatoListener', 'Stopped.');
  }
}

module.exports = PotatoListener;
