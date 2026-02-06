import React from 'react';
import { Paper, Text, Title, Center } from '@mantine/core';

export const Welcome: React.FC = () => (
  <Paper bg="var(--mantine-color-dark-6)" radius="md" p="lg" mb="lg">
    <Center py="xl">
      <div style={{ textAlign: 'center' }}>
        <Title order={3} mb="xs">Select an Account</Title>
        <Text c="dimmed">Choose an account from the sidebar to launch the viewer</Text>
      </div>
    </Center>
  </Paper>
);
