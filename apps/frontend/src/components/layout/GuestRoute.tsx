import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function GuestRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'authenticated') {
    return <Navigate to="/projects" replace />;
  }

  return <>{children}</>;
}
