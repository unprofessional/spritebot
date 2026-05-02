/* eslint-env node */
/* global beforeEach */

const { resetDb } = require('../src/db/client');

beforeEach(async () => {
  await resetDb();
});
