# 🤖 Robinhood Chain Alert Bot

A professional Telegram bot that monitors **Pons** and **Potato Pad** launchpads on the Robinhood Chain and sends real-time alerts whenever a new token is deployed.

---

## 📋 Features

- ✅ Monitors **both** Pons (`pons.family/launchpad`) and Potato Pad (`potato.fm`) simultaneously
- 🔔 Real-time alerts for every new token launch
- 🧾 Displays: token name, symbol, supply, creation date/time, launchpad, dev buy amount & %, creator address, creator's previous tokens, socials (Twitter/Telegram/Website), and explorer links
- ♻️ Automatic reconnect if RPC drops
- 🛡️ Rate-limit aware (handles Telegram 429 errors gracefully)
- 🔁 Deduplication — never sends duplicate alerts

---

## 🚀 Quick Start

### 1. Prerequisites

- **Node.js v18+** — [Download here](https://nodejs.org/)

### 2. Install Dependencies

```bash
cd robinhood-alertbot
npm install
```

### 3. Create Your Telegram Bot

1. Open Telegram and message **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the bot token — it looks like `1234567890:AABBccDDeeff...`
4. This is already in your `.env` as `Telegram_Bot_Token`

### 4. Get Your Telegram Chat ID

#### For a Channel:
1. Create a Telegram channel
2. Add your bot as an **Administrator** with "Post Messages" permission
3. Send a test message to the channel
4. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
5. Find `"chat":{"id":-1001234567890}` — that negative number is your Chat ID

#### For a Group:
1. Add your bot to the group
2. Make the bot an admin
3. Use the same `getUpdates` URL above

### 5. Configure `.env`

Edit `.env` and fill in your `TELEGRAM_CHAT_ID`:

```env
Telegram_Bot_Token=YOUR_BOT_TOKEN_HERE
TELEGRAM_CHAT_ID=-1001234567890

RPC_URL=https://rpc.mainnet.chain.robinhood.com
CHAIN_ID=4663

PONS_FACTORY_ADDRESS=0x0c37a24F5D23A486FA692d1500881d698B1F77a4
POTATO_FACTORY_ADDRESS=0xc12723c251dABcBe10c4F44060A6AE6b5E96a79d

BLOCKSCOUT_API_URL=https://robinhoodchain.blockscout.com/api/v2
POLL_INTERVAL_MS=3000
```

### 6. Run the Bot

```bash
npm start
```

You should see:
```
[INFO] [main] 🚀 Robinhood Alert Bot starting…
[INFO] [main] ✅ Connected to chain: unknown (ID: 4663)
[INFO] [PonsListener] ✅ Subscribed via polling
[INFO] [PotatoListener] ✅ Subscribed via polling
[INFO] [main] ✅ All listeners active — bot is running!
```

And your Telegram channel will receive a startup message. 🎉

---

## 📸 Example Alert

```
🌉 New Token on Pons 🌉
━━━━━━━━━━━━━━━━━━━

📋 Token Details
├─ 🏷  Name: MoonCat ($MCAT)
├─ 📅 Created: Jul 18, 2026 · 19:52:31 UTC
├─ 🏗  Launchpad: Pons
└─ 📦 Total Supply: 1,000,000,000

👤 Creator Info
├─ 🔑 Address: 0x3e20...b145 (clickable link)
├─ 💰 Dev Buy: 0.2000 ETH
└─ 🆕 Creator: First token launched

🌐 Socials
└─ 𝕏 Twitter  |  ✈️ Telegram

🔗 Links
├─ 📊 View Token on Explorer
├─ 🧾 View Launch Tx
└─ 💱 Trade $MCAT on Pons

━━━━━━━━━━━━━━━━━━━
⚠️ DYOR — Not financial advice.
```

---

## 🔄 Running in the Background (Production)

Install PM2 to keep the bot running forever:

```bash
npm install -g pm2
pm2 start src/index.js --name robinhood-alertbot
pm2 save
pm2 startup
```

---

## 🏗 Project Structure

```
robinhood-alertbot/
├── .env                          # Environment config
├── package.json
├── README.md
└── src/
    ├── index.js                  # Entry point
    ├── config.js                 # Config loader & validator
    ├── bot/
    │   └── telegramBot.js        # Telegram messaging
    ├── listeners/
    │   ├── ponsListener.js       # Pons factory event listener
    │   └── potatoListener.js     # Potato Pad factory event listener
    ├── enrichers/
    │   └── tokenEnricher.js      # Fetches metadata + creator history
    ├── formatters/
    │   └── alertFormatter.js     # Builds Telegram HTML messages
    └── utils/
        ├── blockscout.js         # Blockscout REST API helper
        ├── logger.js             # Levelled console logger
        └── retry.js              # Exponential backoff retry
```

---

## 🔧 Discovered Factory Contracts

| Launchpad   | Contract Address                             | Event              |
|-------------|----------------------------------------------|--------------------|
| Pons        | `0x0c37a24F5D23A486FA692d1500881d698B1F77a4` | `TokenLaunched`    |
| Potato Pad  | `0xc12723c251dABcBe10c4F44060A6AE6b5E96a79d` | `TokenCreated` + `DevBuy` |

---

## ⚙️ Environment Variables

| Variable               | Required | Description                                  |
|------------------------|----------|----------------------------------------------|
| `Telegram_Bot_Token`   | ✅       | Your bot token from BotFather                |
| `TELEGRAM_CHAT_ID`     | ✅       | Channel/group ID to post alerts to           |
| `RPC_URL`              | ✅       | Robinhood Chain RPC (public one is pre-set)  |
| `PONS_FACTORY_ADDRESS` | ✅       | Pons factory contract (pre-set)              |
| `POTATO_FACTORY_ADDRESS`| ✅      | Potato Pad factory contract (pre-set)        |
| `BLOCKSCOUT_API_URL`   | ✅       | Blockscout API base URL (pre-set)            |
| `POLL_INTERVAL_MS`     | ❌       | Polling interval in ms (default: 3000)       |
| `LOG_LEVEL`            | ❌       | `debug`/`info`/`warn`/`error` (default: info)|
