import React from 'react';
import { Account, Grid, ViewerInstance } from '../../shared/types';

const formatUptime = (startTime: number): string => {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
};

interface ViewerStatusProps {
  account: Account;
  grid: Grid;
  instance: ViewerInstance;
  onStop: () => void;
}

export const ViewerStatus: React.FC<ViewerStatusProps> = ({
  account,
  grid,
  instance,
  onStop,
}) => (
    <div className="form-section">
      <h3>{account.firstName} {account.lastName}</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
        Grid: {grid.name}
      </p>

      <div style={{ marginBottom: '16px' }}>
        <div className="account-status" style={{ marginBottom: '8px' }}>
          <span className={`status-dot ${instance.status}`} />
          <span style={{ textTransform: 'capitalize' }}>{instance.status}</span>
        </div>
        <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          <div>PID: {instance.pid}</div>
          <div>Uptime: {formatUptime(instance.startTime)}</div>
          <div>WebSocket Port: {instance.wsPort}</div>
        </div>
      </div>

      <div className="btn-group">
        <button className="btn btn-danger" onClick={onStop}>
          Stop Viewer
        </button>
      </div>
    </div>
  );
