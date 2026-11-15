import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, initialTheme } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { Gate } from './components/Gate.tsx';
import { cloudConfigured, startCloud, useCloud } from './cloud.ts';
import './styles.css';

// the sign-in screen draws before the app does, in the same colours
document.documentElement.dataset.theme = initialTheme();

// With accounts set up, the site is for approved accounts only: everyone else gets the sign-in screen, and the data
// file isn't even fetched. An approved account's data comes down before the app first draws, so every page starts
// from it. Built without Supabase settings, the site is open as before.
function Root() {
  const cloud = useCloud();
  if (cloudConfigured && cloud.access !== 'approved') return <Gate />;
  return <App />;
}

void startCloud();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
