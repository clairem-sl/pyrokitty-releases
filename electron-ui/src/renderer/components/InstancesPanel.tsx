import React from 'react';
import { Account, Grid, ViewerInstance } from '../../shared/types';

interface InstancesPanelProps {
  instances: ViewerInstance[];
  accounts: Account[];
  grids: Grid[];
  onStopInstance: (instanceId: string) => void;
}

export const InstancesPanel: React.FC<InstancesPanelProps> = ({
  instances,
  accounts,
  grids,
  onStopInstance,
}) => {
  const getAccount = (accountId: string): Account | undefined => {
    return accounts.find((a) => a.id === accountId);
  };

  const getGrid = (gridId: string): Grid | undefined => {
    return grids.find((g) => g.id === gridId);
  };

  const runningInstances = instances.filter((i) =>
    ['starting', 'running', 'connected'].includes(i.status)
  );

  if (runningInstances.length === 0) {
    return null;
  }

  return (
    <div className="instances-panel">
      <h3>Running Viewers ({runningInstances.length})</h3>

      {runningInstances.map((instance) => {
        const account = getAccount(instance.accountId);
        const grid = getGrid(instance.gridId);

        return (
          <div key={instance.id} className="instance-item">
            <div className="instance-info">
              <span className={`status-dot ${instance.status}`} />
              <div>
                <div className="instance-name">
                  {account ? `${account.firstName} ${account.lastName}` : 'Unknown'}
                </div>
                <div className="instance-details">
                  {grid?.name || 'Unknown Grid'} | Port {instance.wsPort}
                </div>
              </div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => onStopInstance(instance.id)}
            >
              Stop
            </button>
          </div>
        );
      })}
    </div>
  );
};
