import React from 'react';

/**
 * VULN: Admin page - only protected by client-side route check.
 * Any authenticated user can access /admin directly.
 */
function AdminPage({ user }) {
  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ color: '#ef4444', marginBottom: '24px' }}>⚠️ Admin Panel</h2>
      
      <div style={{
        backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
        marginBottom: '24px', border: '1px solid #7f1d1d'
      }}>
        <p style={{ color: '#fca5a5' }}>
          Logged in as: <strong>{user?.username}</strong> (Role: {user?.role})
        </p>
        <p style={{ color: '#6b7280', marginTop: '8px', fontSize: '14px' }}>
          Admin functionality will be implemented in Phase 3+.
          For now, this page demonstrates the broken access control - 
          any authenticated user can reach this route.
        </p>
      </div>

      <div style={{
        backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
        border: '1px solid #1f2937'
      }}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>Available Admin Endpoints (REST)</h3>
        <ul style={{ color: '#6b7280', lineHeight: '2' }}>
          <li>GET /actuator/env - Environment variables (secrets!)</li>
          <li>GET /actuator/heapdump - JVM heap dump</li>
          <li>GET /actuator/mappings - All API routes</li>
          <li>GET /api/debug/user-info - All user data</li>
          <li>POST /api/debug/execute - Remote code execution</li>
          <li>GET /h2-console - H2 database console</li>
        </ul>
      </div>
    </div>
  );
}

export default AdminPage;
