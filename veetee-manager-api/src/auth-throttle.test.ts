import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LoginThrottle } from './auth-throttle.js'

test('login throttle applies IP and identity buckets and expires lockout', () => {
  let now = 1_000
  const throttle = new LoginThrottle({ maxAttempts: 2, windowMs: 10_000, lockoutMs: 5_000, maxBuckets: 12 }, () => now)

  assert.equal(throttle.check('127.0.0.1', 'OWNER@example.test').allowed, true)
  assert.equal(throttle.recordFailure('127.0.0.1', 'OWNER@example.test').allowed, true)
  const locked = throttle.recordFailure('127.0.0.1', 'owner@example.test')
  assert.equal(locked.allowed, false)
  assert.equal(locked.retryAfterSeconds, 5)
  assert.equal(throttle.check('127.0.0.1', 'owner@example.test').allowed, false)

  now += 5_001
  assert.equal(throttle.check('127.0.0.1', 'owner@example.test').allowed, true)
  throttle.recordSuccess('127.0.0.1', 'owner@example.test')
  assert.equal(throttle.size, 0)
})

test('login throttle stays bounded when identities rotate', () => {
  let now = 2_000
  const throttle = new LoginThrottle({ maxAttempts: 5, windowMs: 10_000, lockoutMs: 1_000, maxBuckets: 6 }, () => now)
  for (let index = 0; index < 20; index += 1) throttle.recordFailure('127.0.0.1', `user-${index}@example.test`)
  assert.equal(throttle.size <= 6, true)
  now += 10_001
  assert.equal(throttle.check('127.0.0.1', 'new@example.test').allowed, true)
})
