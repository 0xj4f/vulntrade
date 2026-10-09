import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/apiService';

/**
 * VULN: Auth context stores role in client state.
 * VULN: Role used for client-side route guards (bypassable).
 * VULN: Full user object including sensitive data in React state.
 * VULN: Token stored in localStorage (accessible via XSS).
 */
const AuthContext = createContext(null);

/**
 * Decode JWT payload without signature verification.
 * VULN: Client decodes JWT to read claims including PII - no verification.
 */
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return {};
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch (e) {
    return {};
  }
}

/**
 * Read + merge the persisted session from localStorage.
 * VULN: Token/user restored from localStorage (accessible via XSS).
 * Returns { token, user } with nulls when nothing valid is stored.
 */
function loadStoredAuth() {
  try {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!storedToken || !storedUser) return { token: null, user: null };
    const userData = JSON.parse(storedUser);
    // Merge JWT claims into user state (VULN: PII from JWT in React state)
    const jwtClaims = decodeJWT(storedToken);
    const merged = { ...userData, ...jwtClaims };
    // Restore photoUrl from profilePic if the explicit photoUrl wasn't persisted
    if (!merged.photoUrl && merged.profilePic) merged.photoUrl = merged.profilePic;
    return { token: storedToken, user: merged };
  } catch (e) {
    // Invalid stored data — clear it so later reads are consistent
    try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch (_) { /* ignore */ }
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }) {
  // Restore synchronously via lazy initialisers so a page refresh on a protected
  // route doesn't bounce to /login (and land on /dashboard) before an effect runs.
  const [user, setUser] = useState(() => loadStoredAuth().user);
  const [token, setToken] = useState(() => loadStoredAuth().token);
  // Seed from the restored user so refreshUser() works even before the sync effect runs
  const userIdRef = useRef(user?.userId || user?.id || null); // stable ref so refreshUser doesn't close over user
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!loadStoredAuth().token);
  const [loading] = useState(false); // restore is synchronous now — kept for API compatibility

  const login = async (username, password) => {
    const res = await api.post('/api/auth/login', { username, password });
    const data = res.data;

    // VULN: Store everything in localStorage
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data));

    // Decode JWT and merge claims into user state (VULN: PII exposed in React state)
    const jwtClaims = decodeJWT(data.token);
    const merged = { ...data, ...jwtClaims };
    // Restore photo URL so nav avatar reflects existing profile pic after login
    if (!merged.photoUrl && merged.profilePic) merged.photoUrl = merged.profilePic;

    setToken(data.token);
    setUser(merged);
    setIsAuthenticated(true);

    return data;
  };

  const register = async (username, password, email) => {
    const res = await api.post('/api/auth/register', { username, password, email });
    const data = res.data;

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data));

    const jwtClaims = decodeJWT(data.token);
    const merged = { ...data, ...jwtClaims };

    setToken(data.token);
    setUser(merged);
    setIsAuthenticated(true);

    return data;
  };

  const logout = () => {
    // Tell the server so the logout security event fires (fire-and-forget).
    // Send the token explicitly: the axios request interceptor reads it from
    // localStorage in a microtask that runs AFTER the removeItem calls below, so
    // relying on the interceptor would send this request with no Authorization
    // header and the server would log the logout as userId=null.
    const authToken = localStorage.getItem('token');
    api.post('/api/auth/logout', null,
      authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined
    ).catch(() => {});
    // VULN: Token not invalidated server-side - old token still works
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  // VULN: Role check is purely client-side
  const isAdmin = () => {
    return user?.role === 'ADMIN';
  };

  const isDeveloper = () => {
    return user?.role === 'DEVELOPER';
  };

  // Keep userIdRef in sync so refreshUser never closes over a stale user object
  useEffect(() => { userIdRef.current = user?.userId || user?.id; }, [user?.userId, user?.id]);

  // Refresh user data (e.g. balance) from backend.
  // Uses userIdRef + functional setUser so it never clobbers concurrent updates
  // (e.g. updatePhoto setting photoUrl while a balance refresh is in-flight).
  // Refresh user data (e.g. balance) from backend.
  // NOTE: The API response contains the REAL role from the database,
  // which overwrites any forged JWT role in client state.
  // This is realistic — most apps re-sync user state from the server.
  // The forged JWT still works for API calls (the backend trusts it),
  // but the frontend UI reverts to the DB role. Attack the API, not the UI.
  const refreshUser = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;
    try {
      const res = await api.get(`/api/users/${userId}`);
      setUser(prev => {
        if (!prev) return prev;
        const updated = { ...prev, ...res.data };
        // Propagate profilePic → photoUrl only if photoUrl isn't already set
        if (res.data.profilePic && !updated.photoUrl) {
          updated.photoUrl = res.data.profilePic;
        }
        localStorage.setItem('user', JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      console.error('Failed to refresh user:', e);
    }
  }, []); // stable — reads userId via ref, writes via functional setUser

  // Refresh JWT token from server (gets new token with current DB state)
  // Used after profile update triggers account level change
  const refreshToken = async () => {
    try {
      const res = await api.post('/api/auth/refresh-token');
      const data = res.data;

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data));

      const jwtClaims = decodeJWT(data.token);
      const merged = { ...data, ...jwtClaims };
      if (!merged.photoUrl && merged.profilePic) merged.photoUrl = merged.profilePic;

      setToken(data.token);
      setUser(merged);

      return data;
    } catch (e) {
      console.error('Failed to refresh token:', e);
    }
  };

  // Account level helpers
  const getAccountLevel = () => user?.accountLevel || 1;
  const isVerified = () => (user?.accountLevel || 1) >= 2;

  // Update the user's photo URL in state and localStorage so nav reflects immediately.
  // Accepts the exact URL to use (caller generates it once so nav and page share the same URL).
  // Uses functional setUser to avoid stale closure issues.
  const updatePhoto = useCallback((photoUrl) => {
    const profilePic = photoUrl.split('?')[0]; // stable base URL without cache-bust param
    setUser(prevUser => {
      if (!prevUser) return prevUser;
      const updated = { ...prevUser, photoUrl, profilePic };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const value = {
    user,
    token,
    isAuthenticated,
    loading,
    login,
    register,
    logout,
    isAdmin,
    isDeveloper,
    refreshUser,
    refreshToken,
    getAccountLevel,
    isVerified,
    updatePhoto,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export default AuthContext;
