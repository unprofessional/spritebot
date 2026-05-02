/* eslint-env node */

module.exports = async () => {
  const { closeDb } = require('../src/db/client');

  await closeDb({ force: true });
};
