interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class FastCacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();

  /**
   * Get cached data if valid
   */
  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  /**
   * Set cache entry with TTL (default 2000ms)
   */
  public set<T>(key: string, data: T, ttlMs: number = 2000): void {
    // Keep max size bounded to prevent memory leaks
    if (this.cache.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.cache.entries()) {
        if (now > v.expiresAt) this.cache.delete(k);
      }
    }
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs
    });
  }

  /**
   * Invalidate specific key or pattern
   */
  public invalidate(prefix?: string): void {
    if (!prefix) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries upon mutation
   */
  public invalidateAll(): void {
    this.cache.clear();
  }
}

export const fastCache = new FastCacheService();
