import React from 'react';
import { Account, Grid, ViewerInstance } from '../../shared/types';

const getStatusText = (instance: ViewerInstance | undefined): string => {
  if (!instance) return 'Offline';
  switch (instance.status) {
    case 'starting':
      return 'Starting...';
    case 'running':
      return 'Running';
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Disconnected';
    case 'crashed':
      return 'Crashed';
    default:
      return 'Unknown';
  }
};

interface AccountListProps {
  accounts: Account[];
  grids: Grid[];
  instances: ViewerInstance[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
}

export const AccountList: React.FC<AccountListProps> = ({
  accounts,
  grids,
  instances,
  selectedAccountId,
  onSelectAccount,
  onAddAccount,
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
          <div className="empty-state">
            <p>No accounts yet</p>
          </div>
        ) : (
          accounts.map((account) => {
            const instance = getInstanceForAccount(account.id);
            const isRunning = instance && ['starting', 'running', 'connected'].includes(instance.status);

            return (
              <div
                key={account.id}
                className={`account-item ${selectedAccountId === account.id ? 'selected' : ''} ${isRunning ? 'running' : ''}`}
                onClick={() => onSelectAccount(account.id)}
              >
                <div className="account-name">
                  {account.firstName} {account.lastName}
                </div>
                <div className="account-grid">
                  {getGridName(account.gridId)}
                </div>
                <div className="account-status">
                  <span className={`status-dot ${instance?.status || ''}`} />
                  <span>{getStatusText(instance)}</span>
                </div>
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
