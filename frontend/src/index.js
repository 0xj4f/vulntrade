import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// VULN: Register service worker that caches sensitive API responses
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[SW] Service Worker registered:', registration.scope);
        console.log('[SW] VULN: Caching sensitive API responses including tokens and user data');
      })
      .catch((error) => {
        console.log('[SW] Registration failed:', error);
      });
  });
}
