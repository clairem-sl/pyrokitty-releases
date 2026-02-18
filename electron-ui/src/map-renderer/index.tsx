import React from 'react';
import { createRoot } from 'react-dom/client';
import { MapApp } from './MapApp';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<MapApp />);
}
