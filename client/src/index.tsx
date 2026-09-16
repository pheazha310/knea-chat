import React from 'react';
import ReactDOM from 'react-dom/client';
import './app/styles/index.css';
import './app/styles/App.css';
import { initTheme } from './app/providers/ThemeProvider';
import App from './app/App';
import reportWebVitals from './reportWebVitals';

initTheme();

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

reportWebVitals();
