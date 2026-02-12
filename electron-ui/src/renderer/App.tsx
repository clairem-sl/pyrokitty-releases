import React, { useState, useCallback, useEffect } from 'react';
import { ipcRenderer } from 'electron';
import { MantineProvider, Alert } from '@mantine/core';
import { theme } from './theme';
import { useGrids, useAccounts, useViewers, useChat, useFriends, useGroups, useNearbyAvatars, useRegionInfo, useInventorySync } from './hooks';
import { AccountList } from './components/AccountList';
import { LoginForm } from './components/LoginForm';
import { Welcome } from './components/Welcome';
import { ConfirmDialog } from './components/ConfirmDialog';
import { MfaModal } from './components/MfaModal';
import { ChatWindow } from './components/ChatWindow';
import { Friend, Group, NearbyAvatar, IPC_CHANNELS } from '../shared/types';

type View = 'account' | 'add-account';

export const App: React.FC = () => {
  const { grids, getGrid } = useGrids();
  const { accounts, addAccount, updateAccount, removeAccount, getAccount } = useAccounts();
  const { instances, launchViewer, launchViewerForInstance, stopViewer, getInstanceForAccount, isRunning } = useViewers();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<View>('account');
  const [error, setError] = useState<string | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mfaState, setMfaState] = useState<{ instanceId: string } | null>(null);

  // Listen for MFA challenges from main process
  useEffect(() => {
    const handler = (_event: any, data: { instanceId: string }) => {
      setMfaState({ instanceId: data.instanceId });
    };
    ipcRenderer.on(IPC_CHANNELS.MFA_REQUIRED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.MFA_REQUIRED, handler);
    };
  }, []);

  const handleMfaSubmit = async (token: string) => {
    if (!mfaState) return;
    await ipcRenderer.invoke(IPC_CHANNELS.MFA_SUBMIT, mfaState.instanceId, token);
    setMfaState(null);
  };

  const selectedAccount = getAccount(selectedAccountId || '') || null;
  const selectedGrid = selectedAccount ? getGrid(selectedAccount.gridId) || null : null;
  const selectedInstance = getInstanceForAccount(selectedAccountId || '') || null;
  const activeInstanceId = selectedInstance?.id || null;

  // Chat, friends, and groups hooks
  const {
    nearbyMessages,
    sessions,
    activeSessionId,
    sendNearbyChat,
    sendIM,
    sendGroupMessage,
    startIMSession,
    startGroupChat,
    selectSession,
    getSessionMessages,
    dismissSession,
    clearSessionHistory,
  } = useChat({ instanceId: activeInstanceId });

  const { onlineFriends, offlineFriends } = useFriends({ instanceId: activeInstanceId });
  const { groups } = useGroups({ instanceId: activeInstanceId });
  const { nearbyAvatars } = useNearbyAvatars({ instanceId: activeInstanceId });
  const { regionInfo } = useRegionInfo({ instanceId: activeInstanceId });
  const { status: syncStatus, startSync, openFolder: openSyncFolder } = useInventorySync({ instanceId: activeInstanceId });

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

  // Login to metaverse only (no viewer launch)
  const handleLogin = async (password?: string, startLocation?: string) => {
    if (!selectedAccountId) return;

    try {
      if (password) {
        await updateAccount(selectedAccountId, { password });
      }

      // Pass launchViewer: false to only login to metaverse
      await launchViewer(selectedAccountId, password, { launchViewer: false, startLocation });
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to login');
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

  // Launch viewer when already logged into metaverse
  const handleLaunchViewerFromMetaverse = async () => {
    if (!selectedInstance?.id) return;

    try {
      // Tell the backend to launch the viewer with handoff from the existing metaverse connection
      await launchViewerForInstance(selectedInstance.id);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to launch viewer');
    }
  };

  // Chat handlers
  const handleStartIMWithFriend = useCallback(async (friend: Friend) => {
    if (!activeInstanceId) return;
    await startIMSession(friend.id, friend.name);
  }, [activeInstanceId, startIMSession]);

  const handleStartIMWithAvatar = useCallback(async (avatar: NearbyAvatar) => {
    if (!activeInstanceId) return;
    await startIMSession(avatar.id, avatar.name);
  }, [activeInstanceId, startIMSession]);

  const handleOpenGroupChat = useCallback(async (group: Group) => {
    if (!activeInstanceId) return;
    await startGroupChat(group.id);
  }, [activeInstanceId, startGroupChat]);

  const handleSendNearbyChat = useCallback(async (message: string, type?: 'whisper' | 'normal' | 'shout') => {
    await sendNearbyChat(message, type || 'normal');
  }, [sendNearbyChat]);

  const handleSendIM = useCallback(async (participantId: string, message: string) => {
    await sendIM(participantId, message);
  }, [sendIM]);

  const handleSendGroupMessage = useCallback(async (groupId: string, message: string) => {
    await sendGroupMessage(groupId, message);
  }, [sendGroupMessage]);

  // Determine if we should show chat panel
  const connectionState = selectedInstance?.connectionState || 'disconnected';
  const canShowChat = selectedInstance && ['metaverse_connected', 'viewer_connected', 'logging_in', 'handoff_in_progress', 'mfa_pending'].includes(connectionState);

  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <div className="app">
        <header className="header">
          <h1>PyroKitty</h1>
          <div className="header-actions">
            <span className="header-info">
              {instances.filter(isRunning).length} account(s) connected
            </span>
          </div>
        </header>

        <div className="main-content">
          <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-content">
              <AccountList
                accounts={accounts}
                grids={grids}
                instances={instances}
                selectedAccountId={selectedAccountId}
                onSelectAccount={handleSelectAccount}
                onAddAccount={handleAddAccount}
                onStopInstance={handleStopViewer}
                onLaunchViewer={launchViewerForInstance}
              />
            </div>
          </aside>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Show accounts' : 'Hide accounts'}
          >
            {sidebarCollapsed ? '\u25B6' : '\u25C0'}
          </button>

          <main className="content">
            {error && <Alert color="red" mb="md">{error}</Alert>}

            {currentView === 'add-account' ? (
              <LoginForm
                key="add-account"
                grids={grids}
                onSubmit={handleSaveAccount}
                onCancel={() => setCurrentView('account')}
                error={null}
              />
            ) : selectedAccount && canShowChat ? (
              <ChatWindow
                connectionState={connectionState}
                nearbyMessages={nearbyMessages}
                onSendNearbyChat={handleSendNearbyChat}
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelectSession={selectSession}
                getSessionMessages={getSessionMessages}
                onSendIM={handleSendIM}
                onSendGroupMessage={handleSendGroupMessage}
                onlineFriends={onlineFriends}
                offlineFriends={offlineFriends}
                onStartIMWithFriend={handleStartIMWithFriend}
                onStartIMWithAvatar={handleStartIMWithAvatar}
                groups={groups}
                onOpenGroupChat={handleOpenGroupChat}
                onDismissSession={dismissSession}
                onClearSessionHistory={clearSessionHistory}
                nearbyAvatars={nearbyAvatars}
                regionInfo={regionInfo}
                syncStatus={syncStatus}
                onSyncNow={startSync}
                onOpenSyncFolder={openSyncFolder}
              />
            ) : selectedAccount ? (
              <LoginForm
                key={selectedAccount.id}
                grids={grids}
                account={selectedAccount}
                onLogin={handleLogin}
                onCancel={() => setSelectedAccountId(null)}
                onRemove={handleRemoveAccount}
                error={null}
              />
            ) : (
              <Welcome />
            )}
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

      <MfaModal
        opened={mfaState !== null}
        onClose={() => setMfaState(null)}
        onSubmit={handleMfaSubmit}
        accountName={selectedAccount ? `${selectedAccount.firstName} ${selectedAccount.lastName}` : undefined}
      />
    </MantineProvider>
  );
};
