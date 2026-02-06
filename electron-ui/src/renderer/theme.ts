import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'fire',
  colors: {
    fire: [
      '#fff4e6',
      '#ffe8cc',
      '#ffd8a8',
      '#ffc078',
      '#ffa94d',  // bright orange
      '#ff922b',  // primary fire orange
      '#fd7e14',
      '#e8590c',
      '#d9480f',  // deep fire red-orange
      '#c92a2a',
    ],
    dark: [
      '#eaeaea',  // 0: text-primary
      '#a0a0a0',  // 1: text-secondary
      '#7a7a8a',  // 2: dimmed text (descriptions, hints)
      '#717397',  // 3: borders
      '#2a2a4a',  // 4: subtle borders
      '#1a1a2e',  // 5: bg-primary
      '#16213e',  // 6: bg-secondary
      '#0f3460',  // 7: bg-tertiary/accents
      '#0a0a14',  // 8: deep bg
      '#05050a',  // 9: darkest
    ],
  },
});
