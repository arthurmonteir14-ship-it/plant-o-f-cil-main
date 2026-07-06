import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Wallet, ListChecks, Tags, FileBarChart2, Receipt,
  LogOut, UserPlus, Building2,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { useAuth } from '@/hooks/useAuth';
import { roleLabel } from '@/lib/format';

const mainItems = [
  { title: 'Dashboard', url: '/', icon: LayoutDashboard },
];

const financeiroItems = [
  { title: 'Lançamentos', url: '/financeiro/lancamentos', icon: ListChecks },
  { title: 'Tabela de Valores', url: '/financeiro/tabela-valores', icon: Tags, adminOnly: true },
  { title: 'Cooperados', url: '/cadastros/cooperados', icon: UserPlus },
  { title: 'Clientes', url: '/cadastros/clientes', icon: Building2 },
  { title: 'Fechamento', url: '/financeiro/fechamento', icon: Receipt },
  { title: 'Relatórios', url: '/financeiro/relatorios', icon: FileBarChart2 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const { user, roles, signOut, hasFinanceiroAccess, hasRole } = useAuth();

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const showFinanceiro = hasFinanceiroAccess();
  const canEditValores = hasRole('admin_master') || hasRole('administrativo');

  const userInitial = user?.email?.[0]?.toUpperCase() ?? '?';
  const roleName = roles.length ? roles.map(r => roleLabel[r]).join(', ') : 'Sem perfil';

  return (
    <Sidebar collapsible="icon">
      {/* ── Brand ── */}
      <SidebarHeader className="border-b border-sidebar-border">
        <div className={`flex items-center gap-2.5 px-3 py-[14px] ${collapsed ? 'justify-center' : ''}`}>
          <img src="/logo-cades.svg" alt="CADES" className="h-7 w-7 flex-shrink-0" />
          {!collapsed && (
            <div className="leading-none">
              <p className="text-[14px] font-bold tracking-tight text-sidebar-primary">CADES</p>
              <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-widest mt-0.5">
                Financeiro
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        {/* Geral */}
        <SidebarGroup>
          {!collapsed && (
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Geral
            </p>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              {mainItems.map(item => {
                const active = isActive(item.url);
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active}>
                      <NavLink
                        to={item.url}
                        end
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors
                          ${active
                            ? 'bg-primary/10 text-primary'
                            : 'text-sidebar-foreground hover:bg-sidebar-border/50 hover:text-sidebar-primary'
                          }
                          ${collapsed ? 'justify-center px-2' : ''}
                        `}
                      >
                        <item.icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-primary' : ''}`} />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Financeiro */}
        {showFinanceiro && (
          <SidebarGroup className="mt-5">
            {!collapsed && (
              <div className="mb-1 flex items-center gap-1.5 px-2">
                <Wallet className="h-3 w-3 text-muted-foreground/40" />
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  Financeiro
                </p>
              </div>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-px">
                {financeiroItems
                  .filter(it => !it.adminOnly || canEditValores)
                  .map(item => {
                    const active = isActive(item.url);
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={active}>
                          <NavLink
                            to={item.url}
                            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors
                              ${active
                                ? 'bg-primary/10 text-primary'
                                : 'text-sidebar-foreground hover:bg-sidebar-border/50 hover:text-sidebar-primary'
                              }
                              ${collapsed ? 'justify-center px-2' : ''}
                            `}
                          >
                            <item.icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-primary' : ''}`} />
                            {!collapsed && <span>{item.title}</span>}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* ── Footer ── */}
      <SidebarFooter className="border-t border-sidebar-border p-2">
        {!collapsed ? (
          <div className="flex items-center gap-2.5 p-1.5">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ background: 'var(--gradient-brand)' }}>
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-sidebar-primary leading-tight">
                {user?.email?.split('@')[0] ?? 'Usuário'}
              </p>
              <p className="truncate text-[10px] text-muted-foreground/60">{roleName}</p>
            </div>
            <button
              onClick={signOut}
              title="Sair"
              className="rounded-md p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={signOut}
            title="Sair"
            className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
