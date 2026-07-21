'use strict';

const { EventEmitter } = require('events');
const { ethers }       = require('ethers');
const blockscout       = require('../utils/blockscout');
const logger           = require('../utils/logger');
const { sleep }        = require('../utils/retry');
const config           = require('../config');

// ── Event topics ──────────────────────────────────────────────────────────────
// TokenCreated — includes name, symbol, socials inline
const TOKEN_CREATED_TOPIC =
  '0x875522b092d9e19a1de359e4bd218090d582fa521c9733889acf1a5ff1941255';
// DevBuy — emitted in the same tx when creator buys at launch
const DEV_BUY_TOPIC =
  '0x84d429ed8af1c9cfe8bb07b556e4120e976c9f4c9232a7f50a15d31d83e232a9';

const iface = new ethers.Interface([
  'event TokenCreated(address indexed token, address indexed creator, string name, string symbol, string imageURI, string website, string twitter, string telegram)',
  'event DevBuy(address indexed token, uint256 ethIn, uint256 tokensOut)'
]);

class PotatoListener extends EventEmitter {
  constructor(provider) {
    super();
    this.provider = provider;
    this.lastBlock  = 0;
    this._running   = false;
    this._seenTxHashes = new Set();
    this._devBuyCache = new Map();
  }

  async start() {
    this._running = true;
    logger.info('PotatoListener', `Starting RPC polling for ${config.contracts.potato}`);

    // Initialise lastBlock to current tip so we only alert on NEW tokens
    while (!this.lastBlock) {
      try {
        this.lastBlock = await this.provider.getBlockNumber();
        logger.info('PotatoListener', `✅ Ready — polling from block ${this.lastBlock}`);
      } catch (err) {
        logger.warn('PotatoListener', `Could not get latest block (${err.message}), retrying in 5s...`);
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
        logger.error('PotatoListener', 'Poll cycle error:', err.message);
      }
    }
  }

  async _check() {
    let latestBlock;
    try {
      latestBlock = await this.provider.getBlockNumber();
    } catch (e) {
      logger.warn('PotatoListener', `RPC getBlockNumber failed: ${e.message}`);
      return;
    }

    if (latestBlock <= this.lastBlock) return;

    let logs;
    try {
      logs = await this.provider.getLogs({
        address: config.contracts.potato,
        topics: [[TOKEN_CREATED_TOPIC, DEV_BUY_TOPIC]],
        fromBlock: this.lastBlock + 1,
        toBlock: latestBlock
      });
    } catch (err) {
      logger.warn('PotatoListener', `RPC getLogs failed: ${err.message}`);
      return;
    }

    this.lastBlock = latestBlock;

    if (!logs.length) return;

    // Pass 1: Cache DevBuy events
    for (const log of logs) {
      if (log.topics[0] === DEV_BUY_TOPIC) {
        try {
          const parsed = iface.parseLog(log);
          this._devBuyCache.set(log.transactionHash, {
            ethIn: parsed.args.ethIn.toString(),
            tokensOut: parsed.args.tokensOut.toString()
          });
        } catch (e) {}
      }
    }

    // Pass 2: Process TokenCreated events
    for (const log of logs) {
      if (log.topics[0] !== TOKEN_CREATED_TOPIC) continue;

      const txHash = log.transactionHash;
      if (!txHash || this._seenTxHashes.has(txHash)) continue;
      this._seenTxHashes.add(txHash);
      if (this._seenTxHashes.size > 500) {
        this._seenTxHashes.delete(this._seenTxHashes.values().next().value);
      }

      let parsed;
      try {
        parsed = iface.parseLog(log);
      } catch (e) { continue; }

      const tokenAddress   = parsed.args.token;
      const creatorAddress = parsed.args.creator;

      if (!tokenAddress) continue;

      logger.info('PotatoListener', `🥔 Token created: ${tokenAddress}`);

      const devBuy = this._devBuyCache.get(txHash);
      if (devBuy) this._devBuyCache.delete(txHash);

      this.emit('newToken', {
        tokenAddress,
        creatorAddress,
        txHash,
        timestamp:    new Date().toISOString(),
        launchpad:    'Potato Pad',
        name:         parsed.args.name     || null,
        symbol:       parsed.args.symbol   || null,
        imageURI:     parsed.args.imageURI || null,
        website:      parsed.args.website  || null,
        twitter:      parsed.args.twitter  || null,
        telegram:     parsed.args.telegram || null,
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
