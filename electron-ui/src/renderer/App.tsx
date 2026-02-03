import React, { useState, useCallback } from 'react';
import { MantineProvider } from '@mantine/core';
import { theme } from './theme';
import { useGrids, useAccounts, useViewers, useChat, useFriends, useGroups } from './hooks';
import { AccountList } from './components/AccountList';
import { LoginForm } from './components/LoginForm';
import { ViewerStatus } from './components/ViewerStatus';
import { InstancesPanel } from './components/InstancesPanel';
import { Welcome } from './components/Welcome';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ChatWindow } from './components/ChatWindow';
import { Friend, Group } from '../shared/types';

type View = 'account' | 'add-account';

export const App: React.FC = () => {
  const { grids, getGrid } = useGrids();
  const { accounts, addAccount, updateAccount, removeAccount, getAccount } = useAccounts();
  const { instances, launchViewer, launchViewerForInstance, stopViewer, getInstanceForAccount, isRunning } = useViewers();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<View>('account');
  const [error, setError] = useState<string | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

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
    setActiveSessionId,
    getSessionMessages,
  } = useChat({ instanceId: activeInstanceId });

  const { onlineFriends, offlineFriends } = useFriends({ instanceId: activeInstanceId });
  const { groups } = useGroups({ instanceId: activeInstanceId });

  // Chat window show/hide state
  const [showChat, setShowChat] = useState(false);

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
  const handleLogin = async (password?: string) => {
    if (!selectedAccountId) return;

    try {
      if (password) {
        await updateAccount(selectedAccountId, { password });
      }

      // Pass launchViewer: false to only login to metaverse
      await launchViewer(selectedAccountId, password, { launchViewer: false });
      setError(null);
      setShowChat(true); // Auto-show chat panel on login
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
  const canShowChat = selectedInstance && ['metaverse_connected', 'viewer_connected', 'logging_in', 'handoff_in_progress'].includes(connectionState);

  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
    <div className="app">
      <header className="header">
        <h1>PyroKitty</h1>
        <div className="header-actions">
          {canShowChat && (
            <button
              className={`btn ${showChat ? 'btn-primary' : 'btn-secondary'} header-chat-btn`}
              onClick={() => setShowChat(!showChat)}
            >
              {showChat ? 'Hide Chat' : 'Show Chat'}
            </button>
          )}
          <span className="header-info">
            {instances.filter(isRunning).length} viewer(s) running
          </span>
        </div>
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
              onLaunchViewer={handleLaunchViewerFromMetaverse}
            />
          ) : selectedAccount ? (
            <LoginForm
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

          <InstancesPanel
            instances={instances}
            accounts={accounts}
            grids={grids}
            onStopInstance={handleStopViewer}
          />
        </main>

        {/* Chat sidebar */}
        {showChat && canShowChat && (
          <aside className="chat-sidebar">
            <ChatWindow
              connectionState={connectionState}
              nearbyMessages={nearbyMessages}
              onSendNearbyChat={handleSendNearbyChat}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={setActiveSessionId}
              getSessionMessages={getSessionMessages}
              onSendIM={handleSendIM}
              onSendGroupMessage={handleSendGroupMessage}
              onlineFriends={onlineFriends}
              offlineFriends={offlineFriends}
              onStartIMWithFriend={handleStartIMWithFriend}
              groups={groups}
              onOpenGroupChat={handleOpenGroupChat}
            />
          </aside>
        )}
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
