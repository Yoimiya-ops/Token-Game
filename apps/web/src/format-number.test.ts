import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactNumber } from './format-number';

test('compact numbers use English K M B without redundant zeroes', () => {
  for (const [value, expected] of [[0, '0'], [999, '999'], [1000, '1K'], [1500, '1.5K'], [100000, '100K'],
    [1000000, '1M'], [7500000, '7.5M'], [110000000, '110M'], [1000000000, '1B'], [2500000000, '2.5B'], [1e12, '1000B']] as const) {
    assert.equal(compactNumber(value), expected);
  }
});

test('compact rounding promotes unit boundaries and retains the sign', () => {
  assert.equal(compactNumber(999949), '999.9K');
  assert.equal(compactNumber(999950), '1M');
  assert.equal(compactNumber(999950000), '1B');
  assert.equal(compactNumber(-7500000), '-7.5M');
});
