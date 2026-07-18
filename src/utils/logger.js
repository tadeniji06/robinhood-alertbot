'use strict';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const ACTIVE_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function timestamp() {
  return new Date().toISOString();
}

function log(level, prefix, ...args) {
  if (LEVELS[level] < ACTIVE_LEVEL) return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${timestamp()}] [${level.toUpperCase()}]${prefix ? ` [${prefix}]` : ''}`, ...args);
}

module.exports = {
  debug: (prefix, ...args) => log('debug', prefix, ...args),
  info:  (prefix, ...args) => log('info',  prefix, ...args),
  warn:  (prefix, ...args) => log('warn',  prefix, ...args),
  error: (prefix, ...args) => log('error', prefix, ...args),
};
