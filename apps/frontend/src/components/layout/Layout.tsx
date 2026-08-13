import type { ReactNode } from 'react';
import { Navbar } from './Navbar';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <Navbar />
      <main className="min-w-0 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        <div className="rounded-lg border border-border bg-surface/75 p-5 shadow-[0_20px_70px_oklch(5%_0.01_350_/_0.22)] backdrop-blur-sm sm:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
