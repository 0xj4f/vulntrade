import React, { createContext, useContext } from 'react';
import { useAuth } from './AuthContext';

const DebugContext = createContext(false);

export function DebugProvider({ children }) {
  const { user } = useAuth();
  const isDebug = user?.role === 'DEVELOPER';
  return (
    <DebugContext.Provider value={isDebug}>
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug() {
  return useContext(DebugContext);
}

export default DebugContext;
