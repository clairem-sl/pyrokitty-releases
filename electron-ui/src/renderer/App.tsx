import React, { useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';
import { Grid, Account, ViewerInstance, IPC_CHANNELS } from '../shared/types';
import { AccountList } from './components/AccountList';
import { LoginForm } from './components/LoginForm';
import { ViewerStatus } from './components/ViewerStatus';
import { InstancesPanel } from './components/InstancesPanel';

type View = 'account' | 'add-account';

export const App: React.FC = () => {
  const [grids, setGrids] = useState<Grid[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [instances, setInstances] = useState<ViewerInstance[]>([]);

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<View>('account');
  const [error, setError] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [gridsData, accountsData, instancesData] = await Promise.all([
          ipcRenderer.invoke(IPC_CHANNELS.GET_GRIDS),
          ipcRenderer.invoke(IPC_CHANNELS.GET_ACCOUNTS),
          ipcRenderer.invoke(IPC_CHANNELS.GET_INSTANCES),
        ]);

        setGrids(gridsData);
        setAccounts(accountsData);
        setInstances(instancesData);
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load data');
      }
    };

    loadData();
  }, []);

  // Listen for viewer status updates
  useEffect(() => {
    const handleStatusUpdate = (_: any, instance: ViewerInstance) => {
      setInstances((prev) => {
        const index = prev.findIndex((i) => i.id === instance.id);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = instance;
          return updated;
        }
        return [...prev, instance];
      });
    };

    ipcRenderer.on(IPC_CHANNELS.VIEWER_STATUS_UPDATE, handleStatusUpdate);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.VIEWER_STATUS_UPDATE, handleStatusUpdate);
    };
  }, []);

  // Refresh instances periodically
  useEffect(() => {
    const interval = setInterval(async () => {
      const instancesData = await ipcRenderer.invoke(IPC_CHANNELS.GET_INSTANCES);
      setInstances(instancesData);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;
  const selectedGrid = selectedAccount ? grids.find((g) => g.id === selectedAccount.gridId) || null : null;
  const selectedInstance = instances.find((i) => i.accountId === selectedAccountId) || null;

  const handleSelectAccount = (accountId: string) => {
    setSelectedAccountId(accountId);
    setCurrentView('account');
    setError(null);
  };

  const handleAddAccount = () => {
    setCurrentView('add-account');
    setSelectedAccountId(null);
    setError(null);
  };

  const handleSaveAccount = async (gridId: string, firstName: string, lastName: string, password: string, savePassword: boolean) => {
    try {
      const newAccount = await ipcRenderer.invoke(IPC_CHANNELS.ADD_ACCOUNT, {
        gridId,
        firstName,
        lastName,
        password,
        savePassword,
      });

      setAccounts((prev) => [...prev, newAccount]);
      setSelectedAccountId(newAccount.id);
      setCurrentView('account');
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save account');
    }
  };

  const handleRemoveAccount = async () => {
    if (!selectedAccountId) return;

    if (!confirm('Are you sure you want to remove this account?')) {
      return;
    }

    try {
      await ipcRenderer.invoke(IPC_CHANNELS.REMOVE_ACCOUNT, selectedAccountId);
      setAccounts((prev) => prev.filter((a) => a.id !== selectedAccountId));
      setSelectedAccountId(null);
    } catch (err: any) {
      setError(err.message || 'Failed to remove account');
    }
  };

  const handleLaunchViewer = async (password?: string) => {
    if (!selectedAccountId) return;

    try {
      const instance = await ipcRenderer.invoke(IPC_CHANNELS.LAUNCH_VIEWER, {
        accountId: selectedAccountId,
        password,
      });
      setInstances((prev) => [...prev, instance]);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to launch viewer');
    }
  };

  const handleStopViewer = async (instanceId?: string) => {
    const id = instanceId || selectedInstance?.id;
    if (!id) return;

    try {
      await ipcRenderer.invoke(IPC_CHANNELS.STOP_VIEWER, id);
    } catch (err: any) {
      setError(err.message || 'Failed to stop viewer');
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>PyroKitty</h1>
        <span className="header-info">
          {instances.filter((i) => ['starting', 'running', 'connected'].includes(i.status)).length} viewer(s) running
        </span>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          <AccountList
            accounts={accounts}
            grids={grids}
            instances={instances}
            selectedAccountId={selectedAccountId}
            onSelectAccount={handleSelectAccount}
            onAddAccount={handleAddAccount}
          />
        </aside>

        <main className="content">
          {error && <div className="message error">{error}</div>}

          {currentView === 'add-account' ? (
            <LoginForm
              grids={grids}
              onSubmit={handleSaveAccount}
              onCancel={() => setCurrentView('account')}
              error={null}
            />
          ) : (
            <ViewerStatus
              account={selectedAccount}
              grid={selectedGrid}
              instance={selectedInstance}
              onLaunch={handleLaunchViewer}
              onStop={() => handleStopViewer()}
              onRemoveAccount={handleRemoveAccount}
            />
          )}

          <InstancesPanel
            instances={instances}
            accounts={accounts}
            grids={grids}
            onStopInstance={handleStopViewer}
          />
        </main>
      </div>
    </div>
  );
};
