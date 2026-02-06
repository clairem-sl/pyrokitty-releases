import React from 'react';
import { Text } from '@mantine/core';
import { Account, Grid, ViewerInstance } from '../../shared/types';
import { StatusIndicator, isInstanceRunning, isDisconnecting } from './StatusIndicator';

interface AccountListProps {
  accounts: Account[];
  grids: Grid[];
  instances: ViewerInstance[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onStopInstance: (instanceId: string) => void;
  onLaunchViewer: (instanceId: string) => void;
}

export const AccountList: React.FC<AccountListProps> = ({
  accounts,
  grids,
  instances,
  selectedAccountId,
  onSelectAccount,
  onAddAccount,
  onStopInstance,
  onLaunchViewer,
}) => {
  const getInstanceForAccount = (accountId: string): ViewerInstance | undefined => {
    return instances.find((i) => i.accountId === accountId);
  };

  const getGridName = (gridId: string): string => {
    return grids.find((g) => g.id === gridId)?.name || 'Unknown Grid';
  };

  return (
    <div className="account-list-container">
      <h2>Accounts</h2>
      <div className="account-list">
        {accounts.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">No accounts yet</Text>
        ) : (
          accounts.map((account) => {
            const instance = getInstanceForAccount(account.id);
            const running = isInstanceRunning(instance);
            const stopping = isDisconnecting(instance);

            const isMetaverseOnly = instance?.connectionState === 'metaverse_connected';
            const canLaunchViewer = isMetaverseOnly && !!instance?.regionName && !stopping;

            return (
              <div
                key={account.id}
                className={`account-item ${selectedAccountId === account.id ? 'selected' : ''} ${running ? 'running' : ''}`}
                onClick={() => onSelectAccount(account.id)}
              >
                <div className="account-name">
                  {account.firstName} {account.lastName}
                </div>
                <div className="account-grid">
                  {getGridName(account.gridId)}
                </div>
                <div className="account-status-row">
                  <StatusIndicator instance={instance} />
                  {running && instance && (
                    <button
                      className="account-stop-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStopInstance(instance.id);
                      }}
                      disabled={stopping}
                      title={stopping ? 'Stopping...' : 'Logout'}
                    >
                      {stopping ? '...' : 'Logout'}
                    </button>
                  )}
                </div>
                {running && instance?.regionName && (
                  <div className="account-region">
                    {instance.regionName}
                  </div>
                )}
                {isMetaverseOnly && instance && (
                  <button
                    className="account-launch-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLaunchViewer(instance.id);
                    }}
                    disabled={!canLaunchViewer}
                  >
                    Launch Viewer
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="add-account-btn" onClick={onAddAccount}>
        + Add Account
      </div>
    </div>
  );
};
