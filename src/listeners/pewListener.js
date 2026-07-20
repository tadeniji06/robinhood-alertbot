'use strict';

const { EventEmitter } = require('events');
const blockscout = require('../utils/blockscout');
const logger     = require('../utils/logger');
const { sleep }  = require('../utils/retry');
const config     = require('../config');

// ── Pew.fun factory: 0x3364e68A4454D18132D0a2ac538c966369828291
// TokenCreated(address indexed token, address indexed creator,
//              string name, string symbol, string metadataUri)
// topic0: 0xa5cbe0e1b0c50960e263c4c7edaae241113bbc4725c12b413b4a515fda0d68f0
//
// Launched(address indexed t, address indexed pool,
//          uint256 positionId, uint256 tokensInPool)
// topic0: 0x0cdbb16c91c2a6adc3d86488c96c063a035d5346c7b9f7b4c323f37ca3e4916b

const TOKEN_CREATED_TOPIC =
  '0xa5cbe0e1b0c50960e263c4c7edaae241113bbc4725c12b413b4a515fda0d68f0';

// metadataUri is IPFS; we can try to fetch socials from it later
const IPFS_GATEWAY = 'https://cloudflare-ipfs.com/ipfs/';

class PewListener extends EventEmitter {
  constructor() {
    super();
    this.lastBlock     = 0;
    this._running      = false;
    this._seenTxHashes = new Set();
  }

  async start() {
    this._running = true;
    logger.info('PewListener', `Starting Blockscout polling for ${config.contracts.pew}`);

    try {
      this.lastBlock = await blockscout.getLatestBlock();
      logger.info('PewListener', `✅ Ready — polling from block ${this.lastBlock}`);
    } catch (err) {
      logger.warn('PewListener', 'Could not get latest block:', err.message);
    }

    this._poll();
  }

  async _poll() {
    while (this._running) {
      await sleep(config.polling.intervalMs);
      try {
        await this._check();
      } catch (err) {
        logger.error('PewListener', 'Poll error:', err.message);
      }
    }
  }

  async _check() {
    const logs = await blockscout.getNewLogs(config.contracts.pew, this.lastBlock);
    if (!logs.length) return;

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

      // Try to fetch socials/image from metadataUri (IPFS)
      let imageURI    = null;
      let website     = null;
      let twitter     = null;
      let telegram    = null;
      let description = null;
      const metadataUri = params.metadataUri;

      if (metadataUri) {
        try {
          const axios = require('axios');
          const ipfsHash = metadataUri.replace('ipfs://', '');
          const { data } = await axios.get(`${IPFS_GATEWAY}${ipfsHash}`, { timeout: 5000 });
          imageURI    = data.image || data.imageURI || null;
          website     = data.website || data.url || null;
          twitter     = data.twitter || null;
          telegram    = data.telegram || null;
          description = data.description || null;
        } catch {
          // IPFS fetch failures are non-fatal
        }
      }

      logger.info('PewListener', `🎯 Token created: ${params.symbol || '?'} (${tokenAddress})`);

      this.emit('newToken', {
        tokenAddress,
        creatorAddress,
        txHash,
        timestamp: log.block_timestamp || new Date().toISOString(),
        launchpad: 'Pew.fun',
        name:      params.name   || null,
        symbol:    params.symbol || null,
        description,
        imageURI,
        website,
        twitter,
        telegram,
      });
    }
  }

  stop() {
    this._running = false;
    logger.info('PewListener', 'Stopped.');
  }
}

module.exports = PewListener;
