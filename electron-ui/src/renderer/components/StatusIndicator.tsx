import React from 'react';
import { ViewerInstance } from '../../shared/types';

export const getStatusDotClass = (instance: ViewerInstance | undefined | null): string => {
  if (!instance) return '';
  if (instance.connectionState === 'disconnecting') return 'disconnecting';
  if (instance.connectionState === 'logging_in') return 'starting';
  if (instance.connectionState === 'metaverse_connected' || instance.connectionState === 'viewer_connected') return 'connected';
  return instance.status || '';
};

export const getStatusText = (instance: ViewerInstance | undefined | null): string => {
  if (!instance) return 'Offline';
  // Check connectionState first for more specific states
  if (instance.connectionState === 'disconnecting') return 'Logging out...';
  if (instance.connectionState === 'logging_in') return 'Logging in...';
  if (instance.connectionState === 'metaverse_connected') return 'Connected';
  if (instance.connectionState === 'handoff_in_progress') return 'Launching viewer...';
  if (instance.connectionState === 'viewer_connected') return 'Viewer Connected';
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

export const isInstanceRunning = (instance: ViewerInstance | undefined | null): boolean => {
  if (!instance) return false;
  const hasActiveStatus = ['starting', 'running', 'connected'].includes(instance.status);
  const hasActiveConnection = ['logging_in', 'metaverse_connected', 'handoff_in_progress', 'viewer_connected', 'disconnecting'].includes(instance.connectionState || '');
  return hasActiveStatus || hasActiveConnection;
};

export const isDisconnecting = (instance: ViewerInstance | undefined | null): boolean => {
  return instance?.connectionState === 'disconnecting';
};

interface StatusIndicatorProps {
  instance: ViewerInstance | undefined | null;
  showText?: boolean;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ instance, showText = true }) => {
  return (
    <div className="account-status">
      <span className={`status-dot ${getStatusDotClass(instance)}`} />
      {showText && <span>{getStatusText(instance)}</span>}
    </div>
  );
};
