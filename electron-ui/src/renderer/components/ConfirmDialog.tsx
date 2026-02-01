import React from 'react';
import { Modal, Button, Text, Group } from '@mantine/core';

interface ConfirmDialogProps {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  opened,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}) => (
  <Modal opened={opened} onClose={onClose} title={title} centered>
    <Text size="sm" mb="lg">{message}</Text>
    <Group justify="flex-end">
      <Button variant="default" onClick={onClose}>
        {cancelLabel}
      </Button>
      <Button color="red" onClick={() => { onConfirm(); onClose(); }}>
        {confirmLabel}
      </Button>
    </Group>
  </Modal>
);
