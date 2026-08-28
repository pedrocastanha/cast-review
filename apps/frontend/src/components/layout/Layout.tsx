import type { ReactNode } from 'react';
import { Navbar } from './Navbar';

interface LayoutProps {
  children: ReactNode;
  wide?: boolean;
  fill?: boolean;
}

export function Layout({ children, wide = false, fill = false }: LayoutProps) {
  if (fill) {
    return (
      <div className="lg:grid lg:h-dvh lg:grid-cols-[14.875rem_minmax(0,1fr)] lg:overflow-hidden">
        <Navbar />
        <main className="flex min-h-dvh min-w-0 flex-col lg:h-dvh lg:min-h-0">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[14.875rem_minmax(0,1fr)]">
      <Navbar />
      <main className="min-w-0">
        <div className={`mx-auto w-full px-5 py-7 sm:px-8 lg:px-10 lg:pt-9 lg:pb-20 ${wide ? 'max-w-[82.5rem]' : 'max-w-[73.75rem]'}`}>
          {children}
        </div>
      </main>
    </div>
  );
}
