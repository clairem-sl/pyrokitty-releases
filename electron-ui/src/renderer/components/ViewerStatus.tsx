import React, { useState } from 'react';
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
  account: Account | null;
  grid: Grid | null;
  instance: ViewerInstance | null;
  onLaunch: (password?: string) => void;
  onStop: () => void;
  onRemoveAccount: () => void;
}

export const ViewerStatus: React.FC<ViewerStatusProps> = ({
  account,
  grid,
  instance,
  onLaunch,
  onStop,
  onRemoveAccount,
}) => {
  const [password, setPassword] = useState('');

  if (!account || !grid) {
    return (
      <div className="form-section">
        <div className="empty-state">
          <h3>Select an Account</h3>
          <p>Choose an account from the sidebar to launch the viewer</p>
        </div>
      </div>
    );
  }

  const isRunning = instance && ['starting', 'running', 'connected'].includes(instance.status);
  const hasPassword = !!account.password;

  const handleLaunch = () => {
    if (hasPassword) {
      onLaunch();
    } else if (password) {
      onLaunch(password);
      setPassword('');
    }
  };

  const canLaunch = hasPassword || password.length > 0;

  return (
    <div className="form-section">
      <h3>{account.firstName} {account.lastName}</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
        Grid: {grid.name}
        {hasPassword && <span style={{ marginLeft: '8px', color: 'var(--success)' }}>(password saved)</span>}
      </p>

      {instance && (
        <div style={{ marginBottom: '16px' }}>
          <div className="account-status" style={{ marginBottom: '8px' }}>
            <span className={`status-dot ${instance.status}`} />
            <span style={{ textTransform: 'capitalize' }}>{instance.status}</span>
          </div>
          {isRunning && (
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              <div>PID: {instance.pid}</div>
              <div>Uptime: {formatUptime(instance.startTime)}</div>
              <div>WebSocket Port: {instance.wsPort}</div>
            </div>
          )}
        </div>
      )}

      {!isRunning && !hasPassword && (
        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label htmlFor="launchPassword">Password</label>
          <input
            id="launchPassword"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password to launch"
          />
        </div>
      )}

      <div className="btn-group">
        {isRunning ? (
          <button className="btn btn-danger" onClick={onStop}>
            Stop Viewer
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleLaunch}
            disabled={!canLaunch}
          >
            Launch Viewer
          </button>
        )}
      </div>

      <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-danger" onClick={onRemoveAccount}>
          Remove Account
        </button>
      </div>
    </div>
  );
};
