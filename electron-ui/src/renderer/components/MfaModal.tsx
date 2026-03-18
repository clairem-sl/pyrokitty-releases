import React, { useState } from 'react';
import { Modal, Button, TextInput, Text, Group, Alert, Checkbox } from '@mantine/core';

interface MfaModalProps {
  opened: boolean;
  onClose: () => void;
  onSubmit: (token: string, remember: boolean) => Promise<void>;
  accountName?: string;
}

export const MfaModal: React.FC<MfaModalProps> = ({
  opened,
  onClose,
  onSubmit,
  accountName,
}) => {
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (value: string) => {
    // Strip non-digits and limit to 6 characters
    setToken(value.replace(/\D/g, '').slice(0, 6));
    setError(null);
  };

  const handleSubmit = async () => {
    if (token.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      await onSubmit(token, remember);
      setToken('');
    } catch (err: any) {
      setError(err.message || 'MFA verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setToken('');
    setError(null);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && token.length === 6 && !loading) {
      handleSubmit();
    }
  };

  return (
    <Modal opened={opened} onClose={handleClose} title="Multi-Factor Authentication" centered>
      <Text size="sm" mb="md">
        Enter the 6-digit code from your authenticator app
        {accountName ? ` for ${accountName}` : ''}.
      </Text>
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <TextInput
        placeholder="000000"
        value={token}
        onChange={(e) => handleChange(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        maxLength={6}
        autoFocus
        styles={{ input: { textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5em' } }}
        mb="md"
      />
      <Checkbox
        label="Remember this device"
        checked={remember}
        onChange={(e) => setRemember(e.currentTarget.checked)}
        mb="lg"
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} loading={loading} disabled={token.length !== 6}>
          Verify
        </Button>
      </Group>
    </Modal>
  );
};
