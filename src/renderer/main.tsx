import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { installErrorReporting, reportError } from './lib/telemetry';
import { resolveTerminalFontValue, DEFAULT_FONT_MONO_STACK } from './terminal/terminalFonts';

// Apply the persisted terminal font before React renders so xterm reads the
// correct --terminal-font at construction. Without this, choosing a non-default
// font would flash the default stack on every launch.
const savedFontId = localStorage.getItem('terminalFontFamily') ?? 'system';
const resolvedFont = resolveTerminalFontValue(savedFontId);
if (resolvedFont !== DEFAULT_FONT_MONO_STACK) {
  document.documentElement.style.setProperty('--terminal-font', resolvedFont);
}

installErrorReporting();

// React 19 hands render errors here instead of logging them itself, so log
// as it would, then report (no error boundary renders a fallback yet).
const root = ReactDOM.createRoot(document.getElementById('root')!, {
  onUncaughtError: (error, info) => {
    console.error(error, info.componentStack);
    reportError('react-uncaught', error);
  },
  onCaughtError: (error, info) => {
    console.error(error, info.componentStack);
    reportError('react-caught', error);
  },
});

// `?gallery` shows the primitives gallery instead of the app (dev only: the
// branch is dead code in production builds, so the gallery isn't bundled).
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('gallery')) {
  void import('./gallery/electronApiStub')
    .then(({ installElectronApiStub }) => {
      installElectronApiStub();
      return import('./gallery/Gallery');
    })
    .then(({ Gallery }) =>
      root.render(
        <React.StrictMode>
          <Gallery />
        </React.StrictMode>,
      ),
    );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
