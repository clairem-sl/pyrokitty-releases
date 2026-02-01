import React, { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { theme } from './theme';
import { useGrids, useAccounts, useViewers } from './hooks';
import { AccountList } from './components/AccountList';
import { LoginForm } from './components/LoginForm';
import { ViewerStatus } from './components/ViewerStatus';
import { InstancesPanel } from './components/InstancesPanel';
import { Welcome } from './components/Welcome';
import { ConfirmDialog } from './components/ConfirmDialog';

type View = 'account' | 'add-account';

export const App: React.FC = () => {
  const { grids, getGrid } = useGrids();
  const { accounts, addAccount, updateAccount, removeAccount, getAccount } = useAccounts();
  const { instances, launchViewer, stopViewer, getInstanceForAccount, isRunning } = useViewers();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<View>('account');
  const [error, setError] = useState<string | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  const selectedAccount = getAccount(selectedAccountId || '') || null;
  const selectedGrid = selectedAccount ? getGrid(selectedAccount.gridId) || null : null;
  const selectedInstance = getInstanceForAccount(selectedAccountId || '') || null;

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
      const newAccount = await addAccount(gridId, firstName, lastName, password, savePassword);
      setSelectedAccountId(newAccount.id);
      setCurrentView('account');
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save account');
    }
  };

  const handleRemoveAccount = () => {
    if (!selectedAccountId) return;
    setConfirmRemoveOpen(true);
  };

  const confirmRemoveAccount = async () => {
    if (!selectedAccountId) return;
    try {
      await removeAccount(selectedAccountId);
      setSelectedAccountId(null);
    } catch (err: any) {
      setError(err.message || 'Failed to remove account');
    }
  };

  const handleLaunchViewer = async (password?: string) => {
    if (!selectedAccountId) return;

    try {
      // If user provided a new password, save it
      if (password) {
        await updateAccount(selectedAccountId, { password });
      }

      await launchViewer(selectedAccountId, password);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to launch viewer');
    }
  };

  const handleStopViewer = async (instanceId?: string) => {
    const id = instanceId || selectedInstance?.id;
    if (!id) return;

    try {
      await stopViewer(id);
    } catch (err: any) {
      setError(err.message || 'Failed to stop viewer');
    }
  };

  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
    <div className="app">
      <header className="header">
        <h1>PyroKitty</h1>
        <span className="header-info">
          {instances.filter(isRunning).length} viewer(s) running
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
          ) : selectedAccount && selectedGrid && isRunning(selectedInstance) ? (
            <ViewerStatus
              account={selectedAccount}
              grid={selectedGrid}
              instance={selectedInstance}
              onStop={() => handleStopViewer()}
            />
          ) : selectedAccount ? (
            <LoginForm
              grids={grids}
              account={selectedAccount}
              onLaunch={handleLaunchViewer}
              onCancel={() => setSelectedAccountId(null)}
              onRemove={handleRemoveAccount}
              error={null}
            />
          ) : (
            <Welcome />
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

    <ConfirmDialog
      opened={confirmRemoveOpen}
      onClose={() => setConfirmRemoveOpen(false)}
      onConfirm={confirmRemoveAccount}
      title="Remove Account"
      message="Are you sure you want to remove this account?"
      confirmLabel="Remove"
    />
    </MantineProvider>
  );
};
