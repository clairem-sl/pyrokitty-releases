import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { ChatMessage } from '../shared/types';

const DEBOUNCE_MS = 1000;

function getBaseDir(): string {
  return path.join(app.getAppPath(), 'data', 'chat-logs');
}

export class ChatLogManager {
  // In-memory buffers pending flush: accountId -> sessionId -> messages
  private pendingWrites: Map<string, Map<string, ChatMessage[]>> = new Map();
  private flushTimers: Map<string, NodeJS.Timeout> = new Map();

  getLogDir(accountId: string): string {
    return path.join(getBaseDir(), accountId);
  }

  getLogPath(accountId: string, sessionId: string): string {
    // Sanitize sessionId for use as filename (UUIDs are safe, but be defensive)
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.getLogDir(accountId), `${safeId}.json`);
  }

  loadMessages(accountId: string, sessionId: string): ChatMessage[] {
    try {
      const filePath = this.getLogPath(accountId, sessionId);
      if (!fs.existsSync(filePath)) {
        return [];
      }
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`[ChatLog] Error loading messages for ${accountId}/${sessionId}:`, error);
      return [];
    }
  }

  appendMessage(accountId: string, sessionId: string, message: ChatMessage): void {
    // Add to pending buffer
    if (!this.pendingWrites.has(accountId)) {
      this.pendingWrites.set(accountId, new Map());
    }
    const accountBuffer = this.pendingWrites.get(accountId)!;
    if (!accountBuffer.has(sessionId)) {
      accountBuffer.set(sessionId, []);
    }
    accountBuffer.get(sessionId)!.push(message);

    // Schedule debounced flush
    const timerKey = `${accountId}/${sessionId}`;
    const existing = this.flushTimers.get(timerKey);
    if (existing) {
      clearTimeout(existing);
    }
    this.flushTimers.set(timerKey, setTimeout(() => {
      this.flush(accountId, sessionId);
      this.flushTimers.delete(timerKey);
    }, DEBOUNCE_MS));
  }

  loadAllSessions(accountId: string): { sessionId: string; messages: ChatMessage[] }[] {
    const results: { sessionId: string; messages: ChatMessage[] }[] = [];
    const dir = this.getLogDir(accountId);

    if (!fs.existsSync(dir)) {
      return results;
    }

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const sessionId = file.replace('.json', '');
        const messages = this.loadMessages(accountId, sessionId);
        if (messages.length > 0) {
          results.push({ sessionId, messages });
        }
      }
    } catch (error) {
      console.error(`[ChatLog] Error loading all sessions for ${accountId}:`, error);
    }

    return results;
  }

  /** Flush pending writes for a specific account/session to disk */
  private flush(accountId: string, sessionId: string): void {
    const accountBuffer = this.pendingWrites.get(accountId);
    if (!accountBuffer) return;

    const pending = accountBuffer.get(sessionId);
    if (!pending || pending.length === 0) return;

    try {
      const filePath = this.getLogPath(accountId, sessionId);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Read existing, append new, write back
      let existing: ChatMessage[] = [];
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        existing = JSON.parse(data);
      }

      const merged = [...existing, ...pending];
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
    } catch (error) {
      console.error(`[ChatLog] Error flushing ${accountId}/${sessionId}:`, error);
    }

    // Clear buffer
    accountBuffer.delete(sessionId);
    if (accountBuffer.size === 0) {
      this.pendingWrites.delete(accountId);
    }
  }

  /** Flush all pending writes immediately (call on app quit) */
  flushAll(): void {
    for (const [accountId, accountBuffer] of this.pendingWrites) {
      for (const [sessionId] of accountBuffer) {
        const timerKey = `${accountId}/${sessionId}`;
        const timer = this.flushTimers.get(timerKey);
        if (timer) {
          clearTimeout(timer);
          this.flushTimers.delete(timerKey);
        }
        this.flush(accountId, sessionId);
      }
    }
  }
}

export const chatLogManager = new ChatLogManager();
