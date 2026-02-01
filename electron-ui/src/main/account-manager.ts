import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Account } from '../shared/types';

function getAccountsFilePath(): string {
  return path.join(app.getAppPath(), 'data', 'accounts.json');
}

export class AccountManager {
  private accounts: Account[] = [];

  initialize(): void {
    this.loadAccounts();
    console.log(`Loaded ${this.accounts.length} accounts`);
  }

  private loadAccounts(): void {
    try {
      const accountsFile = getAccountsFilePath();
      if (fs.existsSync(accountsFile)) {
        const data = fs.readFileSync(accountsFile, 'utf-8');
        this.accounts = JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading accounts:', error);
      this.accounts = [];
    }
  }

  private saveAccounts(): void {
    try {
      const accountsFile = getAccountsFilePath();
      const dir = path.dirname(accountsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(accountsFile, JSON.stringify(this.accounts, null, 2));
    } catch (error) {
      console.error('Error saving accounts:', error);
    }
  }

  getAllAccounts(): Account[] {
    return this.accounts;
  }

  getAccountsForGrid(gridId: string): Account[] {
    return this.accounts.filter(a => a.gridId === gridId);
  }

  getAccount(accountId: string): Account | undefined {
    return this.accounts.find(a => a.id === accountId);
  }

  addAccount(gridId: string, firstName: string, lastName: string, password?: string): Account {
    const existing = this.accounts.find(
      a => a.gridId === gridId &&
           a.firstName.toLowerCase() === firstName.toLowerCase() &&
           a.lastName.toLowerCase() === lastName.toLowerCase()
    );

    if (existing) {
      throw new Error('Account already exists for this grid');
    }

    const id = `account_${Date.now()}`;
    const newAccount: Account = {
      id,
      gridId,
      firstName,
      lastName,
    };

    if (password) {
      newAccount.password = password;
    }

    this.accounts.push(newAccount);
    this.saveAccounts();

    return newAccount;
  }

  updateAccount(accountId: string, updates: Partial<{ firstName: string; lastName: string; password: string }>): Account | null {
    const account = this.accounts.find(a => a.id === accountId);
    if (!account) {
      return null;
    }

    if (updates.firstName) account.firstName = updates.firstName;
    if (updates.lastName) account.lastName = updates.lastName;
    if (updates.password) account.password = updates.password;

    this.saveAccounts();
    return account;
  }

  removeAccount(accountId: string): boolean {
    const index = this.accounts.findIndex(a => a.id === accountId);
    if (index === -1) {
      return false;
    }

    this.accounts.splice(index, 1);
    this.saveAccounts();
    return true;
  }
}

export const accountManager = new AccountManager();
