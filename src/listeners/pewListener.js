'use strict';

const { EventEmitter } = require('events');
const { ethers }       = require('ethers');
const blockscout       = require('../utils/blockscout');
const logger           = require('../utils/logger');
const { sleep }        = require('../utils/retry');
const config           = require('../config');

// ── Pew.fun factory: 0x3364e68A4454D18132D0a2ac538c966369828291
// TokenCreated(address indexed token, address indexed creator,
//              string name, string symbol, string metadataUri)
// topic0: 0xa5cbe0e1b0c50960e263c4c7edaae241113bbc4725c12b413b4a515fda0d68f0
//
// Launched(address indexed t, address indexed pool,
//          uint256 positionId, uint256 tokensInPool)
// topic0: 0x0cdbb16c91c2a6adc3d86488c96c063a035d5346c7b9f7b4c323f37ca3e4916b

// The new Pew.fun TokenCreated event topic (V2)
const TOKEN_CREATED_TOPIC =
  '0xfe210c99153843bc67efa2e9a61ec1d63c505e379b9dcf05a9520e84e36e6063';

// metadataUri is IPFS; we can try to fetch socials from it later
const IPFS_GATEWAY = 'https://cloudflare-ipfs.com/ipfs/';

class PewListener extends EventEmitter {
  constructor(provider) {
    super();
    this.provider = provider;
    this.lastBlock     = 0;
    this._running      = false;
    this._seenTxHashes = new Set();
  }

  async start() {
    this._running = true;
    logger.info('PewListener', `Starting RPC polling for ${config.contracts.pew}`);

    // Initialise lastBlock to current tip so we only alert on NEW tokens
    while (!this.lastBlock) {
      try {
        this.lastBlock = await this.provider.getBlockNumber();
        logger.info('PewListener', `✅ Ready — polling from block ${this.lastBlock}`);
      } catch (err) {
        logger.warn('PewListener', `Could not get latest block (${err.message}), retrying in 5s...`);
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
        logger.error('PewListener', 'Poll error:', err.message);
      }
    }
  }

  async _check() {
    let latestBlock;
    try {
      latestBlock = await this.provider.getBlockNumber();
    } catch (e) {
      logger.warn('PewListener', `RPC getBlockNumber failed: ${e.message}`);
      return;
    }

    if (latestBlock <= this.lastBlock) return;

    let logs;
    try {
      logs = await this.provider.getLogs({
        address: config.contracts.pew,
        topics: [TOKEN_CREATED_TOPIC],
        fromBlock: this.lastBlock + 1,
        toBlock: latestBlock
      });
    } catch (err) {
      logger.warn('PewListener', `RPC getLogs failed: ${err.message}`);
      return;
    }

    this.lastBlock = latestBlock;

    if (!logs.length) return;

    for (const log of logs) {
      const txHash = log.transactionHash;
      if (!txHash || this._seenTxHashes.has(txHash)) continue;
      this._seenTxHashes.add(txHash);
      if (this._seenTxHashes.size > 500) {
        this._seenTxHashes.delete(this._seenTxHashes.values().next().value);
      }

      let name, symbol, metadataUri;
      try {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['string', 'string', 'string'], log.data);
        name = decoded[0];
        symbol = decoded[1];
        metadataUri = decoded[2];
      } catch (e) { continue; }

      const tokenAddress   = '0x' + log.topics[1].slice(26);
      const creatorAddress = '0x' + log.topics[2].slice(26);

      if (!tokenAddress) continue;

      // Try to fetch socials/image from metadataUri (IPFS)
      let imageURI    = null;
      let website     = null;
      let twitter     = null;
      let telegram    = null;
      let description = null;

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

      logger.info('PewListener', `🎯 Token created: ${symbol || '?'} (${tokenAddress})`);

      this.emit('newToken', {
        tokenAddress,
        creatorAddress,
        txHash,
        timestamp: new Date().toISOString(),
        launchpad: 'Pew.fun',
        name:      name   || null,
        symbol:    symbol || null,
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
