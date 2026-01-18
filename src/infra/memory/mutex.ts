export class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

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
  private readonly map = new Map<string, Mutex>();

  get(accountId: string): Mutex {
    const existing = this.map.get(accountId);
    if (existing) {
      return existing;
    }
    const created = new Mutex();
    this.map.set(accountId, created);
    return created;
  }
}
