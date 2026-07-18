'use strict';

const logger = require('./logger');

/**
 * Retries an async function with exponential backoff.
 * @param {Function} fn          - Async function to retry
 * @param {number}   maxAttempts - Maximum attempts (default 4)
 * @param {number}   baseDelayMs - Initial delay in ms (default 1000)
 * @param {string}   label       - Label for log messages
 * @returns {Promise<*>}
 */
async function retry(fn, maxAttempts = 4, baseDelayMs = 1000, label = 'retry') {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(label, `Attempt ${attempt}/${maxAttempts} failed. Retrying in ${delay}ms…`, err.message);
      await sleep(delay);
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { retry, sleep };
