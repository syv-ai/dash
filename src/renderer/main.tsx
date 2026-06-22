import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { resolveTerminalFontValue, DEFAULT_FONT_MONO_STACK } from './terminal/terminalFonts';

// Apply the persisted terminal font before React renders so xterm reads the
// correct --terminal-font at construction. Without this, choosing a non-default
// font would flash the default stack on every launch.
const savedFontId = localStorage.getItem('terminalFontFamily') ?? 'system';
const resolvedFont = resolveTerminalFontValue(savedFontId);
if (resolvedFont !== DEFAULT_FONT_MONO_STACK) {
  document.documentElement.style.setProperty('--terminal-font', resolvedFont);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
