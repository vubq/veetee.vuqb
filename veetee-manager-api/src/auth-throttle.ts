export interface LoginThrottleOptions {
  maxAttempts: number
  windowMs: number
  lockoutMs: number
  maxBuckets: number
}

export interface LoginThrottleDecision {
  allowed: boolean
  retryAfterSeconds: number
}

interface Bucket {
  failures: number
  windowStartedAt: number
  lockedUntil: number
  lastTouchedAt: number
}

/**
 * Bounded, process-local login throttle for the single-host Manager baseline.
 * The database session remains the source of truth after a successful login;
 * this short-lived gate only protects Argon2 verification from abuse.
 */
export class LoginThrottle {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly options: LoginThrottleOptions,
    private readonly now: () => number = Date.now,
  ) {}

  check(ip: string, identity: string): LoginThrottleDecision {
    const now = this.now()
    const retryAfterSeconds = Math.max(
      this.retryAfter(this.bucket(this.key('ip', ip), now), now),
      this.retryAfter(this.bucket(this.key('identity', identity), now), now),
      this.retryAfter(this.bucket(this.key('pair', ip, identity), now), now),
    )
    return { allowed: retryAfterSeconds === 0, retryAfterSeconds }
  }

  recordFailure(ip: string, identity: string): LoginThrottleDecision {
    const now = this.now()
    const keys = [this.key('ip', ip), this.key('identity', identity), this.key('pair', ip, identity)]
    let retryAfterSeconds = 0
    for (const key of keys) {
      const bucket = this.bucket(key, now)
      bucket.failures += 1
      bucket.lastTouchedAt = now
      if (bucket.failures >= this.options.maxAttempts) bucket.lockedUntil = Math.max(bucket.lockedUntil, now + this.options.lockoutMs)
      retryAfterSeconds = Math.max(retryAfterSeconds, this.retryAfter(bucket, now))
    }
    this.prune(now)
    return { allowed: retryAfterSeconds === 0, retryAfterSeconds }
  }

  recordSuccess(ip: string, identity: string): void {
    this.buckets.delete(this.key('ip', ip))
    this.buckets.delete(this.key('identity', identity))
    this.buckets.delete(this.key('pair', ip, identity))
  }

  get size(): number { return this.buckets.size }

  private bucket(key: string, now: number): Bucket {
    const current = this.buckets.get(key)
    if (current && (current.lockedUntil > now || now - current.windowStartedAt < this.options.windowMs)) return current
    const next: Bucket = { failures: 0, windowStartedAt: now, lockedUntil: 0, lastTouchedAt: now }
    this.buckets.set(key, next)
    this.prune(now)
    return next
  }

  private retryAfter(bucket: Bucket, now: number): number {
    if (bucket.lockedUntil <= now) return 0
    return Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000))
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastTouchedAt >= this.options.windowMs && bucket.lockedUntil <= now) this.buckets.delete(key)
    }
    while (this.buckets.size > this.options.maxBuckets) {
      const oldest = [...this.buckets.entries()].sort((left, right) => left[1].lastTouchedAt - right[1].lastTouchedAt)[0]
      if (!oldest) break
      this.buckets.delete(oldest[0])
    }
  }

  private key(scope: string, ...parts: string[]): string { return `${scope}:${parts.map((part) => part.trim().toLocaleLowerCase()).join('|')}` }
}

export function normalizeLoginIdentity(value: string): string { return value.trim().toLocaleLowerCase() }
