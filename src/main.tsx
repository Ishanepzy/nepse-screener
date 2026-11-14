import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { cloudRendered, startCloud } from './cloud.ts';
import './styles.css';

// Signed in: the account's data comes down before the first draw, so every page starts from it. A slow network
// doesn't hold the page up for long; it then starts from this browser's copy.
void Promise.race([startCloud(), new Promise((r) => setTimeout(r, 4000))]).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
  cloudRendered();
});
