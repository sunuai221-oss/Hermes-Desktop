import { Suspense, lazy, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { useNavigation } from './hooks/useNavigation';
import { useRuntimeStatus } from './hooks/useRuntimeStatus';
import { useGatewayContext } from './contexts/GatewayContext';
import { FeedbackProvider } from './contexts/FeedbackProvider';
import { GatewayProvider } from './contexts/GatewayProvider';
import { useProfiles } from './contexts/ProfileContext';
import { ProfileProvider } from './contexts/ProfileProvider';
import type { NavItem } from './hooks/useNavigation';

const HomePage = lazy(() => import('./pages/HomePage').then(module => ({ default: module.HomePage })));
const PlatformsPage = lazy(() => import('./pages/PlatformsPage').then(module => ({ default: module.PlatformsPage })));
const SoulPage = lazy(() => import('./pages/SoulPage').then(module => ({ default: module.SoulPage })));
const ContextFilesPage = lazy(() => import('./pages/ContextFilesPage').then(module => ({ default: module.ContextFilesPage })));
const ExtensionsPage = lazy(() => import('./pages/ExtensionsPage').then(module => ({ default: module.ExtensionsPage })));
const AutomationsPage = lazy(() => import('./pages/AutomationsPage').then(module => ({ default: module.AutomationsPage })));
const DelegationPage = lazy(() => import('./pages/DelegationPage').then(module => ({ default: module.DelegationPage })));
const ConfigPage = lazy(() => import('./pages/ConfigPage').then(module => ({ default: module.ConfigPage })));
const SessionsPage = lazy(() => import('./pages/SessionsPage').then(module => ({ default: module.SessionsPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then(module => ({ default: module.ChatPage })));
const SkillsPage = lazy(() => import('./pages/SkillsPage').then(module => ({ default: module.SkillsPage })));
const ProfilesPage = lazy(() => import('./pages/ProfilesPage').then(module => ({ default: module.ProfilesPage })));

export default function App() {
  return (
    <ProfileProvider>
      <FeedbackProvider>
        <GatewayProvider>
          <AppShell />
        </GatewayProvider>
      </FeedbackProvider>
    </ProfileProvider>
  );
}

function AppShell() {
  const { currentProfile } = useProfiles();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= 1024; // lg breakpoint
  });
  const [chatSessionRequest, setChatSessionRequest] = useState<{ sessionId: string | null; nonce: number }>({ sessionId: null, nonce: 0 });
  const gateway = useGatewayContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeNav, navPathMap } = useNavigation();
  const { status: runtimeStatus } = useRuntimeStatus(gateway);

  const closeSidebarOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const handleNavigate = (tab: NavItem) => {
    if (tab === 'docs') {
      window.open('https://hermes-agent.nousresearch.com/docs/', '_blank');
      return;
    }
    closeSidebarOnMobile();
    navigate(navPathMap[tab]);
  };

  const handleOpenSessionInChat = (sessionId: string | null = null) => {
    setChatSessionRequest({ sessionId, nonce: Date.now() });
    closeSidebarOnMobile();
    navigate(navPathMap.chat);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans">
      <Sidebar
        active={activeNav}
        onNavigate={handleNavigate}
        isOpen={sidebarOpen}
      />
      <main className="relative z-10 flex flex-1 flex-col overflow-hidden">
        <Header
          runtimeStatus={runtimeStatus}
          onToggleSidebar={() => setSidebarOpen((current) => !current)}
          sidebarOpen={sidebarOpen}
        />
        <div className="flex-1 overflow-auto p-6 lg:p-8">
          <Suspense fallback={<PageLoader />}>
            <AnimatePresence mode="wait">
              <div key={`${currentProfile}:${location.pathname}`} className="h-full">
                <Routes>
                  <Route path="/" element={<HomePage onNavigate={handleNavigate} onOpenSessionInChat={handleOpenSessionInChat} />} />
                  <Route path="/chat" element={<ChatPage requestedSessionId={chatSessionRequest.sessionId} requestNonce={chatSessionRequest.nonce} />} />
                  <Route path="/sessions" element={<SessionsPage onNavigate={handleNavigate} onOpenSessionInChat={handleOpenSessionInChat} />} />
                  <Route path="/automations" element={<AutomationsPage />} />
                  <Route path="/memory" element={<Navigate to="/identity" replace />} />
                  <Route path="/skills" element={<SkillsPage />} />
                  <Route path="/profiles" element={<ProfilesPage onNavigate={handleNavigate} />} />
                  <Route path="/gateway" element={<Navigate to="/config" replace />} />
                  <Route path="/config" element={<ConfigPage />} />
                  <Route path="/identity" element={<SoulPage />} />
                  <Route path="/providers" element={<Navigate to="/config" replace />} />
                  <Route path="/context-files" element={<ContextFilesPage />} />
                  <Route path="/extensions" element={<ExtensionsPage />} />
                  <Route path="/plugins" element={<Navigate to="/extensions" replace />} />
                  <Route path="/hooks" element={<Navigate to="/extensions" replace />} />
                  <Route path="/delegation" element={<DelegationPage />} />
                  <Route path="/platforms" element={<PlatformsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </AnimatePresence>
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function PageLoader() {
  return (
    <div className="flex h-full w-full">
      {/* Sidebar skeleton */}
      <div className="hidden lg:flex flex-col w-[280px] flex-shrink-0 border-r border-border bg-secondary/50 p-4 gap-3">
        <div className="h-12 w-32 rounded-md bg-muted animate-pulse mb-2" />
        <div className="h-24 w-full rounded-2xl bg-muted animate-pulse mb-4" />
        <SkeletonBar w="40%" h={8} />
        <SkeletonBar w="100%" />
        <SkeletonBar w="85%" />
        <SkeletonBar w="100%" />
        <SkeletonBar w="70%" />
        <div className="mt-3" />
        <SkeletonBar w="40%" h={8} />
        <SkeletonBar w="90%" />
        <SkeletonBar w="100%" />
        <SkeletonBar w="75%" />
        <SkeletonBar w="100%" />
      </div>

      {/* Main area skeleton */}
      <div className="flex-1 flex flex-col">
        {/* Header skeleton */}
        <div className="flex-shrink-0 h-14 border-b border-border flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 rounded bg-muted animate-pulse" />
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-muted animate-pulse" />
            <div className="h-8 w-24 rounded-full bg-muted animate-pulse" />
            <div className="h-2 w-2 rounded-full bg-muted animate-pulse" />
          </div>
        </div>

        {/* Content skeleton */}
        <div className="flex-1 p-6 lg:p-8 space-y-4">
          <SkeletonBar w="45%" h={28} />
          <SkeletonBar w="70%" />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
            <div className="rounded-xl border border-border p-5 space-y-3">
              <SkeletonBar w="35%" h={10} />
              <SkeletonBar w="80%" h={20} />
              <SkeletonBar w="60%" />
              <SkeletonBar w="90%" />
            </div>
            <div className="rounded-xl border border-border p-5 space-y-3">
              <SkeletonBar w="40%" h={10} />
              <SkeletonBar w="70%" h={20} />
              <SkeletonBar w="55%" />
              <SkeletonBar w="85%" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonBar({ w, h = 14 }: { w: string; h?: number }) {
  return (
    <div
      className="rounded-md bg-muted animate-pulse"
      style={{ width: w, height: h }}
    />
  );
}
