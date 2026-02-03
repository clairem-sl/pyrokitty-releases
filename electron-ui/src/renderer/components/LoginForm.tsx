import React, { useState } from 'react';
import { PasswordInput } from '@mantine/core';
import { Grid, Account } from '../../shared/types';

interface LoginFormProps {
  grids: Grid[];
  onSubmit?: (gridId: string, firstName: string, lastName: string, password: string, savePassword: boolean) => void;
  onLogin?: (password?: string) => void;  // Login to metaverse
  onCancel: () => void;
  onRemove?: () => void;
  error: string | null;
  account?: Account | null;  // Pre-populated account for login mode
}

export const LoginForm: React.FC<LoginFormProps> = ({
  grids,
  onSubmit,
  onLogin,
  onCancel,
  onRemove,
  error,
  account,
}) => {
  const isLaunchMode = !!account;
  const hasPassword = isLaunchMode && !!account.password;

  const [selectedGridId, setSelectedGridId] = useState(account?.gridId || '');
  const [firstName, setFirstName] = useState(account?.firstName || '');
  const [lastName, setLastName] = useState(account?.lastName || '');
  const [password, setPassword] = useState(account?.password || '');
  const [savePassword, setSavePassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Default action is login only (not launch viewer)
    if (isLaunchMode && onLogin) {
      onLogin(password || undefined);
    } else if (onSubmit && selectedGridId && firstName.trim() && lastName.trim() && password) {
      onSubmit(selectedGridId, firstName.trim(), lastName.trim(), password, savePassword);
    }
  };

  const selectedGrid = grids.find(g => g.id === selectedGridId);
  const canSubmit = isLaunchMode ? (hasPassword || password.length > 0) : (selectedGridId && firstName && lastName && password);

  return (
    <div className="form-section">
      <h3>{isLaunchMode ? 'Login' : 'Add Account'}</h3>

      {error && <div className="message error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="grid">Grid</label>
          {isLaunchMode ? (
            <input type="text" value={selectedGrid?.name || ''} disabled />
          ) : (
            <select
              id="grid"
              value={selectedGridId}
              onChange={(e) => setSelectedGridId(e.target.value)}
              required
            >
              <option value="" disabled>Select Grid...</option>
              {grids.map((grid) => (
                <option key={grid.id} value={grid.id}>
                  {grid.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="firstName">First Name</label>
            <input
              id="firstName"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First"
              required
              disabled={isLaunchMode}
            />
          </div>
          <div className="form-group">
            <label htmlFor="lastName">Last Name</label>
            <input
              id="lastName"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last"
              required
              disabled={isLaunchMode}
            />
          </div>
        </div>

        <PasswordInput
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          placeholder={hasPassword ? 'Using saved password' : 'Password'}
          required={!hasPassword && password.length === 0}
          description={hasPassword && !password ? 'Leave blank to use saved password' : undefined}
          mb="md"
        />

        {!isLaunchMode && (
          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={savePassword}
                onChange={(e) => setSavePassword(e.target.checked)}
              />
              <span>Save password</span>
            </label>
          </div>
        )}

        <div className="btn-group">
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {isLaunchMode ? 'Login' : 'Save Account'}
          </button>
          {isLaunchMode && onRemove && (
            <button type="button" className="btn btn-danger" onClick={onRemove}>
              Remove
            </button>
          )}
          {!isLaunchMode && (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
