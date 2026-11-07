import axios from 'axios';

// VULN: API URL hardcoded and exposed in client bundle
const API_URL = process.env.REACT_APP_API_URL || '';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add JWT token to all requests
api.interceptors.request.use((config) => {
  // VULN: Token from localStorage
  const token = localStorage.getItem('token');
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// An expired or invalid session: tell the app (AuthContext logs out and shows a message)
// instead of leaving a half-broken UI. Auth endpoints and 403s are left alone.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || '';
    const sentToken = !!error?.config?.headers?.Authorization;
    if (status === 401 && sentToken && !url.includes('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('vt:session-expired'));
    }
    return Promise.reject(error);
  }
);

export default api;
export { API_URL };
