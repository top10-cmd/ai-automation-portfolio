import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { snapshot, AppError } from './core.js';

export class TicketStore {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'journal.json');
    // Fail visibly on damaged storage; never silently discard an existing journal.
    const saved = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { schemaVersion: 1, records: [] };
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.records)) throw new Error('Invalid journal format');
    this.history = saved.records;
    this.active = new Map();
  }
  commit(ticket) {
    const next = [snapshot(ticket), ...this.history.filter(r => r.id !== ticket.id)].slice(0, 500);
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ schemaVersion: 1, records: next }, null, 2), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
    this.history = next;
    this.active.set(ticket.id, ticket);
    return ticket;
  }
  get(id) {
    const item = this.active.get(id);
    if (!item) throw new AppError(404, 'Текст обращения недоступен после перезапуска. Создайте новый анализ.');
    return item;
  }
  list() { return this.history.map(r => ({ ...r, available: this.active.has(r.id) })); }
}
