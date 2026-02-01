import { useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';
import { Account, IPC_CHANNELS } from '../../shared/types';

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await ipcRenderer.invoke(IPC_CHANNELS.GET_ACCOUNTS);
        setAccounts(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load accounts');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const addAccount = async (
    gridId: string,
    firstName: string,
    lastName: string,
    password: string,
    savePassword: boolean
  ): Promise<Account> => {
    const newAccount = await ipcRenderer.invoke(IPC_CHANNELS.ADD_ACCOUNT, {
      gridId,
      firstName,
      lastName,
      password,
      savePassword,
    });
    setAccounts((prev) => [...prev, newAccount]);
    return newAccount;
  };

  const updateAccount = async (accountId: string, updates: Partial<Account>): Promise<Account> => {
    const updated = await ipcRenderer.invoke(IPC_CHANNELS.UPDATE_ACCOUNT, accountId, updates);
    setAccounts((prev) => prev.map((a) => (a.id === accountId ? updated : a)));
    return updated;
  };

  const removeAccount = async (accountId: string): Promise<void> => {
    await ipcRenderer.invoke(IPC_CHANNELS.REMOVE_ACCOUNT, accountId);
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
  };

  const getAccount = (id: string) => accounts.find((a) => a.id === id);

  return {
    accounts,
    loading,
    error,
    addAccount,
    updateAccount,
    removeAccount,
    getAccount,
  };
}
