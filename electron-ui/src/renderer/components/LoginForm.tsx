import React, { useState } from 'react';
import { TextInput, PasswordInput, NativeSelect, Checkbox, Button, Paper, Group, Title, Alert } from '@mantine/core';
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

  const defaultGridId = grids.find(g => g.nick === 'agni')?.id || grids[0]?.id || '';
  const [selectedGridId, setSelectedGridId] = useState(account?.gridId || defaultGridId);
  const [firstName, setFirstName] = useState(account?.firstName || '');
  const [lastName, setLastName] = useState(account?.lastName || 'Resident');
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

  const gridOptions = grids.map((grid) => ({
    value: grid.id,
    label: grid.name,
  }));

  return (
    <Paper bg="var(--mantine-color-dark-6)" radius="md" p="lg" mb="lg">
      <Title order={3} mb="md">{isLaunchMode ? 'Login' : 'Add Account'}</Title>

      {error && <Alert color="red" mb="md">{error}</Alert>}

      <form onSubmit={handleSubmit}>
        {isLaunchMode ? (
          <TextInput
            label="Grid"
            value={selectedGrid?.name || ''}
            disabled
            mb="md"
          />
        ) : (
          <NativeSelect
            label="Grid"
            value={selectedGridId}
            onChange={(e) => setSelectedGridId(e.currentTarget.value)}
            data={gridOptions}
            required
            mb="md"
          />
        )}

        <Group grow mb="md">
          <TextInput
            label="First Name"
            value={firstName}
            onChange={(e) => setFirstName(e.currentTarget.value)}
            placeholder="First"
            required
            disabled={isLaunchMode}
          />
          <TextInput
            label="Last Name"
            value={lastName}
            onChange={(e) => setLastName(e.currentTarget.value)}
            placeholder="Last"
            required
            disabled={isLaunchMode}
          />
        </Group>

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
          <Checkbox
            label="Save password"
            checked={savePassword}
            onChange={(e) => setSavePassword(e.currentTarget.checked)}
            mb="md"
          />
        )}

        <Group mt="md">
          <Button type="submit" disabled={!canSubmit}>
            {isLaunchMode ? 'Login' : 'Save Account'}
          </Button>
          {isLaunchMode && onRemove && (
            <Button color="red" onClick={onRemove}>
              Remove
            </Button>
          )}
          {!isLaunchMode && (
            <Button variant="default" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </Group>
      </form>
    </Paper>
  );
};
