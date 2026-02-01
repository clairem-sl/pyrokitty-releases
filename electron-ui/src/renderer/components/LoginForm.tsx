import React, { useState } from 'react';
import { Grid } from '../../shared/types';

interface LoginFormProps {
  grids: Grid[];
  onSubmit: (gridId: string, firstName: string, lastName: string, password: string, savePassword: boolean) => void;
  onCancel: () => void;
  error: string | null;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  grids,
  onSubmit,
  onCancel,
  error,
}) => {
  const [selectedGridId, setSelectedGridId] = useState(grids[0]?.id || '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [savePassword, setSavePassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedGridId && firstName.trim() && lastName.trim() && password) {
      onSubmit(selectedGridId, firstName.trim(), lastName.trim(), password, savePassword);
    }
  };

  const selectedGrid = grids.find(g => g.id === selectedGridId);

  return (
    <div className="form-section">
      <h3>Add Account</h3>

      {error && <div className="message error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="grid">Grid</label>
          <select
            id="grid"
            value={selectedGridId}
            onChange={(e) => setSelectedGridId(e.target.value)}
            required
          >
            {grids.map((grid) => (
              <option key={grid.id} value={grid.id}>
                {grid.name}
              </option>
            ))}
          </select>
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
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
          />
        </div>

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

        <div className="btn-group">
          <button type="submit" className="btn btn-primary">
            Save Account
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};
