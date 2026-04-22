import { ReactNode } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          {/* Header minimalista */}
          <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border/70 bg-background/90 px-4 backdrop-blur-sm">
            <SidebarTrigger className="h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted transition-colors" />
          </header>
          <main className="flex-1 p-5 md:p-8 animate-fade-in">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
