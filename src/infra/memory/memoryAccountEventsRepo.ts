import { randomUUID } from "crypto";
import { AccountEvent, AccountEventsRepository } from "../../modules/accounts/repository";

export class MemoryAccountEventsRepository implements AccountEventsRepository {
  constructor(private readonly events: AccountEvent[] = []) {}

  async create(event: Omit<AccountEvent, 'eventId'>): Promise<AccountEvent> {
    const newEvent: AccountEvent = {
      ...event,
      eventId: randomUUID()
    };
    this.events.push(newEvent);
    return newEvent;
  }

  async listByAccount(accountId: string): Promise<AccountEvent[]> {
    return this.events
      .filter(e => e.accountId === accountId)
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  }
}
