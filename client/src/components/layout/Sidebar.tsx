import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Map,
  FileText,
  Satellite,
  Layers,
  TriangleAlert,
  BookOpen,
  MessageSquare,
  Settings,
  LogOut,
  User,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { auth } from '@/lib/firebase';
import { handleLogout } from '@/lib/auth';
import { toast } from 'sonner';

interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  circleBg: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard/simcar',
    label: 'SIMCAR',
    description: 'Rural Environmental Registry',
    icon: Map,
    circleBg: 'bg-purple-600',
  },
  {
    href: '/dashboard/recibos',
    label: 'Recibos',
    description: 'Receipts & Documents',
    icon: FileText,
    circleBg: 'bg-green-600',
  },
  {
    href: '/dashboard/cbers',
    label: 'CBERS',
    description: 'Satellite Imagery',
    icon: Satellite,
    circleBg: 'bg-cyan-400',
  },
  {
    href: '/dashboard/landsat',
    label: 'Landsat',
    description: 'Landsat Analysis',
    icon: Layers,
    circleBg: 'bg-accent-emerald',
  },
  {
    href: '/dashboard/erros',
    label: 'Erros',
    description: 'Error Reports',
    icon: TriangleAlert,
    circleBg: 'bg-accent-red',
  },
];

const BOTTOM_ITEMS: NavItem[] = [
  {
    href: '/dashboard/manual',
    label: 'Manual',
    description: 'Features & Docs',
    icon: BookOpen,
    circleBg: 'bg-amber-500',
  },
  {
    href: '/dashboard/chat',
    label: 'Chat Assistant',
    description: 'AI Support',
    icon: MessageSquare,
    circleBg: 'bg-indigo-500',
  },
];

export const Sidebar: React.FC = () => {
  const [location, setLocation] = useLocation();
  const [user, setUser] = useState(auth.currentUser);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((u) => setUser(u));
    return () => unsubscribe();
  }, []);

  const onLogout = async () => {
    try {
      await handleLogout();
      toast.success('Logout realizado com sucesso');
    } catch {
      toast.error('Erro ao fazer logout');
    }
  };

  const isSatelliteScreen =
    location.startsWith('/dashboard/cbers') || location.startsWith('/dashboard/landsat');

  return (
    <div className="w-[280px] h-full bg-sidebar border-r border-border-subtle flex flex-col">
      {/* Logo Area */}
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-xl font-bold font-heading text-white tracking-tight leading-none">
          GeoForest IA
        </h1>
        <p className="text-[10px] text-emerald-400/60 uppercase tracking-[0.2em] font-semibold mt-0.5">
          Forestry Intelligence
        </p>
      </div>

      {/* Logo Divider */}
      <div className="mx-5 h-px bg-border-subtle" />

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = location.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer group',
                  isActive
                    ? 'bg-white-alpha-10 border border-border-glow'
                    : 'border border-transparent hover:bg-white-alpha-10 hover:border-border-subtle',
                )}
              >
                {/* Icon Circle */}
                <div
                  className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-full shrink-0 transition-transform group-hover:scale-105',
                    item.circleBg,
                  )}
                >
                  <Icon className="w-4 h-4 text-white" />
                </div>

                {/* Text Col */}
                <div className="flex flex-col min-w-0 gap-px">
                  <span
                    className={cn(
                      'text-[13px] font-semibold leading-tight transition-colors',
                      isActive ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary',
                    )}
                  >
                    {item.label}
                  </span>
                  <span className="text-[10px] text-text-muted leading-tight truncate">
                    {item.description}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}

        {/* Bottom items (Manual, Chat) */}
        <div className="pt-3 mt-1 border-t border-border-subtle space-y-1">
          {BOTTOM_ITEMS.map((item) => {
            const isActive = location.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer group',
                    isActive
                      ? 'bg-white-alpha-10 border border-border-glow'
                      : 'border border-transparent hover:bg-white-alpha-10 hover:border-border-subtle',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center w-9 h-9 rounded-full shrink-0 transition-transform group-hover:scale-105',
                      item.circleBg,
                    )}
                  >
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex flex-col min-w-0 gap-px">
                    <span
                      className={cn(
                        'text-[13px] font-semibold leading-tight transition-colors',
                        isActive
                          ? 'text-text-primary'
                          : 'text-text-secondary group-hover:text-text-primary',
                      )}
                    >
                      {item.label}
                    </span>
                    <span className="text-[10px] text-text-muted leading-tight truncate">
                      {item.description}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Action Button */}
      <div className="px-4 pb-3">
        {isSatelliteScreen ? (
          <Link href={location.startsWith('/dashboard/cbers') ? '/dashboard/cbers' : '/dashboard/landsat'}>
            <button className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600/20 text-purple-400 rounded-xl border border-purple-500/30 hover:bg-purple-600/30 transition-colors text-[13px] font-semibold">
              <Plus className="w-4 h-4" />
              Novo Mosaico
            </button>
          </Link>
        ) : (
          <Link href="/dashboard/simcar">
            <button className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-500/15 text-emerald-400 rounded-xl border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors text-[13px] font-semibold">
              <Plus className="w-4 h-4" />
              + Novo Clip SIMCAR
            </button>
          </Link>
        )}
      </div>

      {/* User Divider */}
      <div className="mx-4 h-px bg-border-subtle" />

      {/* User Area */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-white-alpha-10 border border-border-subtle flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-text-muted" />
        </div>

        {/* User Info */}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[13px] font-semibold text-text-primary truncate leading-tight">
            {user?.displayName || 'Usuário'}
          </span>
          <span className="text-[10px] text-text-muted truncate leading-tight">
            {user?.email || 'usuario@geoforest.ai'}
          </span>
        </div>

        {/* Settings + Logout */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Link href="/dashboard/configuracoes">
            <button
              className="p-1.5 text-text-muted hover:text-text-secondary hover:bg-white-alpha-10 rounded-lg transition-colors"
              title="Configurações"
            >
              <Settings className="w-4 h-4" />
            </button>
          </Link>
          <button
            onClick={onLogout}
            className="p-1.5 text-text-muted hover:text-accent-red hover:bg-accent-red/10 rounded-lg transition-colors"
            title="Sair"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
