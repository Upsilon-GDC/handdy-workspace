import { test } from 'node:test';
import assert from 'node:assert/strict';
import getApiErrorMessage from '../src/utils/getApiErrorMessage.js';

test('Production prerequisite failures explain setup while other server errors stay private', () => {
  const error = (status, data) => ({ response: { status, data } });
  assert.equal(getApiErrorMessage(error(503, { code: 'PRODUCTION_INITIALIZATION_REQUIRED', message: 'private driver details' })),
    'Production setup is incomplete. Initialize Production before saving settings.');
  for (const status of [500, 503]) assert.equal(getApiErrorMessage(error(status, { message: 'private driver details' })),
    'The server could not complete the request. Please try again later.');
});
