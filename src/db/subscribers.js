'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DB_PATH = path.join(__dirname, '../../data/subscribers.json');

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Adds a subscriber by chat ID (works for private users AND groups/channels).
 * @param {object} msg - Full Telegram message object
 * @returns {boolean} true if newly added
 */
function addSubscriber(msg) {
  const db = load();
  const chatId = String(msg.chat.id);
  const isNew  = !db[chatId];

  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup' || msg.chat.type === 'channel';

  db[chatId] = {
    chatId,
    type:      msg.chat.type,
    // For groups/channels store the group name; for private chats store the user
    name:      isGroup
      ? (msg.chat.title || 'Group')
      : (msg.from?.first_name || msg.from?.username || 'User'),
    username:  isGroup ? null : (msg.from?.username || null),
    joinedAt:  db[chatId]?.joinedAt || new Date().toISOString(),
  };
  save(db);

  if (isNew) {
    logger.info('subscribers', `✅ New subscriber: ${db[chatId].name} (${msg.chat.type}) [${chatId}]`);
  }
  return isNew;
}

/**
 * Removes a subscriber by chat ID.
 * @param {string|number} chatId
 */
function removeSubscriber(chatId) {
  const db = load();
  const id = String(chatId);
  if (db[id]) {
    delete db[id];
    save(db);
    logger.info('subscribers', `🚫 Unsubscribed: ${id}`);
  }
}

/**
 * Returns all subscriber chat IDs.
 * @returns {string[]}
 */
function getAllIds() {
  return Object.keys(load());
}

/**
 * Returns the total subscriber count.
 * @returns {number}
 */
function count() {
  return Object.keys(load()).length;
}

module.exports = { addSubscriber, removeSubscriber, getAllIds, count };
