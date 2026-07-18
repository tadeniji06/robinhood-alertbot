'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DB_PATH = path.join(__dirname, '../../data/subscribers.json');

// Ensure data directory exists
function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Loads all subscribers from disk.
 * @returns {{ [chatId: string]: { chatId: string, username?: string, firstName?: string, joinedAt: string } }}
 */
function load() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Saves subscriber map to disk.
 * @param {Object} data
 */
function save(data) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Adds a subscriber. Returns true if newly added, false if already existed.
 * @param {object} user - Telegram user object from message
 * @returns {boolean}
 */
function addSubscriber(user) {
  const db = load();
  const id = String(user.id);
  const isNew = !db[id];
  db[id] = {
    chatId:    id,
    username:  user.username  || null,
    firstName: user.first_name || null,
    joinedAt:  new Date().toISOString(),
  };
  save(db);
  if (isNew) logger.info('subscribers', `✅ New subscriber: ${user.first_name || user.username || id}`);
  return isNew;
}

/**
 * Removes a subscriber.
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
 * Returns all subscriber chat IDs as an array of strings.
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
