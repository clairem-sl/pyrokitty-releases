/**
 * DisplayNameCache - In-memory cache with disk persistence for SL display names.
 *
 * Stores display name → legacy name mappings per account.
 * Entries older than 24h are considered stale (still returned, but should be re-fetched).
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface DisplayNameEntry {
  displayName: string;    // Custom display name, or legacy name if default
  legacyName: string;     // "FirstName LastName"
  username: string;       // "firstname.lastname"
  isDefault: boolean;     // true if display name is generated from legacy name
  fetchedAt: number;      // timestamp ms
}

const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

export class DisplayNameCache {
  private cache: Map<string, DisplayNameEntry> = new Map();
  private filePath: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(accountId: string) {
    const dataDir = path.join(app.getPath('userData'), 'data', 'display-names');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.join(dataDir, `${accountId}.json`);
    this.load();
  }

  get(uuid: string): DisplayNameEntry | undefined {
    return this.cache.get(uuid);
  }

  isStale(uuid: string): boolean {
    const entry = this.cache.get(uuid);
    if (!entry) return true;
    return Date.now() - entry.fetchedAt > STALE_MS;
  }

  set(uuid: string, entry: DisplayNameEntry): void {
    this.cache.set(uuid, entry);
    this.scheduleSave();
  }

  /**
   * Returns the best display name for a UUID.
   * The displayName field from the server is always the right name to show —
   * it's either the custom display name or the cleaned-up legacy name.
   */
  getBestName(uuid: string): string | undefined {
    const entry = this.cache.get(uuid);
    if (!entry) return undefined;
    return entry.displayName;
  }

  bulkSet(entries: Map<string, { displayName: string; username: string; legacyFirst: string; legacyLast: string; isDefault: boolean }>): void {
    const now = Date.now();
    for (const [uuid, data] of entries) {
      this.cache.set(uuid, {
        displayName: data.displayName,
        legacyName: `${data.legacyFirst} ${data.legacyLast}`,
        username: data.username,
        isDefault: data.isDefault,
        fetchedAt: now,
      });
    }
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) {
        this.save();
      }
    }, 5000); // Debounce saves to every 5 seconds
  }

  save(): void {
    try {
      const data: Record<string, DisplayNameEntry> = {};
      for (const [uuid, entry] of this.cache) {
        data[uuid] = entry;
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
      this.dirty = false;
      console.log(`[DisplayNameCache] Saved ${this.cache.size} entries`);
    } catch (err) {
      console.error('[DisplayNameCache] Save error:', err);
    }
  }

  load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, DisplayNameEntry>;
      for (const [uuid, entry] of Object.entries(data)) {
        this.cache.set(uuid, entry);
      }
      console.log(`[DisplayNameCache] Loaded ${this.cache.size} entries`);
    } catch (err) {
      console.error('[DisplayNameCache] Load error:', err);
    }
  }

  /** Flush pending saves (call on shutdown) */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      this.save();
    }
  }

  size(): number {
    return this.cache.size;
  }
}
