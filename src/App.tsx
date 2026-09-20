import { useState } from 'react';
import { AdminLogin } from './components/AdminLogin';
import { AdminConsole } from './components/AdminConsole';
import { apiClient } from './lib/apiClient';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return apiClient.isAuthenticated();
  });

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    apiClient.logout();
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <AdminLogin onLoginSuccess={handleLoginSuccess} />;
  }

  return <AdminConsole onLogout={handleLogout} />;
}

export default App;
