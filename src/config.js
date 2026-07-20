'use strict';

require('dotenv').config();

const required = [
  'Telegram_Bot_Token',
  'RPC_URL',
  'PONS_FACTORY_ADDRESS',
  'POTATO_FACTORY_ADDRESS',
  'PEW_FACTORY_ADDRESS',
  'BLOCKSCOUT_API_URL',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[Config] ❌  Missing required env var: ${key}`);
    process.exit(1);
  }
}

module.exports = {
  telegram: {
    token: process.env.Telegram_Bot_Token,
  },
  rpc: {
    url: process.env.RPC_URL,
    chainId: Number(process.env.CHAIN_ID) || 4663,
  },
  contracts: {
    pons:   process.env.PONS_FACTORY_ADDRESS,
    potato: process.env.POTATO_FACTORY_ADDRESS,
    pew:    process.env.PEW_FACTORY_ADDRESS,
  },
  blockscout: {
    apiUrl: process.env.BLOCKSCOUT_API_URL,
  },
  polling: {
    intervalMs: Number(process.env.POLL_INTERVAL_MS) || 3000,
  },
};
