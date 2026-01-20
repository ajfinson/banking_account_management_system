export class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  isLocked(): boolean {
    return this.locked || this.queue.length > 0;
  }

  async lock(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        const next = this.queue.shift();
        if (next) {
          next();
        } else {
          this.locked = false;
        }
      };

      if (this.locked) {
        this.queue.push(() => resolve(release));
      } else {
        this.locked = true;
        resolve(release);
      }
    });
  }
}

export class MutexMap {
  private readonly map = new Map<string, { mutex: Mutex; lastUsed: number }>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes
  private destroyed = false;

  constructor() {
    // Periodically clean up unused mutexes
    this.cleanupInterval = setInterval(() => {
      if (!this.destroyed) {
        this.cleanup();
      }
    }, 60_000);
  }

  get(accountId: string): Mutex {
    const existing = this.map.get(accountId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.mutex;
    }
    const created = { mutex: new Mutex(), lastUsed: Date.now() };
    this.map.set(accountId, created);
    return created.mutex;
  }

  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    
    // First pass: identify candidates for deletion
    for (const [key, value] of this.map.entries()) {
      if (now - value.lastUsed > this.TTL_MS && !value.mutex.isLocked()) {
        toDelete.push(key);
      }
    }
    
    // Second pass: delete if still unlocked (double-check)
    for (const key of toDelete) {
      const value = this.map.get(key);
      if (value && !value.mutex.isLocked()) {
        this.map.delete(key);
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.map.clear();
  }
}
