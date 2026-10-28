import { useColorScheme } from 'react-native';

const light = {
  bg: '#f6f7f9',
  card: '#ffffff',
  text: '#14171c',
  muted: '#5d6672',
  border: '#dde1e7',
  accent: '#1f6feb',
  accentText: '#ffffff',
  good: '#1a7f37',
  bad: '#c62828',
  chip: '#e8eef8',
};

const dark: typeof light = {
  bg: '#0e1116',
  card: '#171b22',
  text: '#e8ebf0',
  muted: '#9aa4b2',
  border: '#2a313c',
  accent: '#4c8dff',
  accentText: '#ffffff',
  good: '#3fb950',
  bad: '#ff6b6b',
  chip: '#1c2533',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
