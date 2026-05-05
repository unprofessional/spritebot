/* eslint-env node */

module.exports = async () => {
  process.env.NODE_ENV = 'test';
  process.env.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '__TEST_DISCORD_TOKEN__';
  process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '__TEST_CLIENT_ID__';
  process.env.DEV_GUILD_ID = process.env.DEV_GUILD_ID || '__TEST_DEV_GUILD__';
  process.env.OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID || '__TEST_OWNER__';

  const { initDb } = require('../src/db/client');

  await initDb();
};
