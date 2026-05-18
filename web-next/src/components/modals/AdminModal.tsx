import { useCallback, useEffect, useState } from "react";
import {
  X, Users, Swords, MessageSquare, Trophy, Activity, Shield,
  ChevronLeft, ChevronRight, Search, Music, HeartPulse, Server,
  TrendingUp, Award, Star, Clock, BarChart3, Zap, Eye, EyeOff,
  ChevronDown, ChevronUp
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  clearAdminSecret,
  getAdminSecret,
  getAdminChatMessages,
  getAdminChatStats,
  getAdminDashboardSummary,
  getAdminLeaderboard,
  getAdminMatchStats,
  getAdminMatches,
  getAdminResultSounds,
  getAdminSystemHealth,
  getAdminTestLabSessions,
  getAdminTestLabStats,
  getAdminUser,
  getAdminUserMatches,
  getAdminUserRatingHistory,
  getAdminUsers,
  getAdminVerificationSessions,
  getAdminVerificationStats,
  setAdminUserRole,
  setAdminSecret,
  type AdminChatMessage,
  type AdminDashboardSummary,
  type AdminMatchEntry,
  type AdminRatingEntry,
  type AdminRatingHistoryEntry,
  type AdminResultSound,
  type AdminServiceHealth,
  type AdminTestLabSession,
  type AdminUser,
  type AdminVerificationSession,
} from "@/lib/admin";

interface AdminModalProps {
  onClose: () => void;
}

type AdminTab = "overview" | "users" | "matches" | "leaderboard" | "chat" | "verification" | "testlab" | "sounds" | "health";

export default function AdminModal({ onClose }: AdminModalProps) {
  const [secret, setSecretInput] = useState("");
  const [storedSecret, setStoredSecret] = useState<string | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [loading, setLoading] = useState(false);

  // Overview
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [matchStats, setMatchStats] = useState<{ stats: { matches: number; draws: number; disconnect_finishes: number; average_score: number; average_duration_sec: number } } | null>(null);
  const [chatStats, setChatStats] = useState<{ stats: { total_messages: number; messages_today: number; top_senders: { user_id: string; nickname: string; messages: number }[] } } | null>(null);
  const [verificationStats, setVerificationStats] = useState<{ stats: { total_sessions: number; completed_sessions: number; pass_rate: number; issued_tokens: number; used_tokens: number; token_consume_rate: number } } | null>(null);
  const [testLabStats, setTestLabStats] = useState<{ stats: { total_sessions: number; sessions_today: number; total_samples: number; average_final_score: number; completion_rate: number } } | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; services: Record<string, AdminServiceHealth> } | null>(null);

  // Users
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersCursor, setUsersCursor] = useState("");
  const [usersNextCursor, setUsersNextCursor] = useState("");
  const [usersQuery, setUsersQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userMatches, setUserMatches] = useState<AdminMatchEntry[]>([]);
  const [userRatingHistory, setUserRatingHistory] = useState<AdminRatingHistoryEntry[]>([]);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [roleEditValue, setRoleEditValue] = useState("");

  // Matches
  const [matches, setMatches] = useState<AdminMatchEntry[]>([]);
  const [matchesCursor, setMatchesCursor] = useState("");
  const [matchesNextCursor, setMatchesNextCursor] = useState("");

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<AdminRatingEntry[]>([]);
  const [lbCursor, setLbCursor] = useState("");
  const [lbNextCursor, setLbNextCursor] = useState("");

  // Chat
  const [chatMessages, setChatMessages] = useState<AdminChatMessage[]>([]);

  // Verification
  const [verificationSessions, setVerificationSessions] = useState<AdminVerificationSession[]>([]);

  // Test Lab
  const [testLabSessions, setTestLabSessions] = useState<AdminTestLabSession[]>([]);

  // Sounds
  const [sounds, setSounds] = useState<AdminResultSound[]>([]);

  useEffect(() => {
    setStoredSecret(getAdminSecret());
  }, []);

  const handleSecretSubmit = useCallback(() => {
    if (!secret.trim()) {
      setSecretError("Enter secret key");
      return;
    }
    setAdminSecret(secret.trim());
    setStoredSecret(secret.trim());
    setSecretError(null);
  }, [secret]);

  const handleClearSecret = useCallback(() => {
    clearAdminSecret();
    setStoredSecret(null);
    setSecretInput("");
  }, []);

  const withLoading = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setSecretError(null);
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setSecretError(msg);
      if (msg.includes("401") || msg.includes("403")) {
        handleClearSecret();
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [handleClearSecret]);

  const fetchOverview = useCallback(async () => {
    const [s, ms, cs, vs, ts, h] = await Promise.all([
      withLoading(() => getAdminDashboardSummary()),
      withLoading(() => getAdminMatchStats()),
      withLoading(() => getAdminChatStats()),
      withLoading(() => getAdminVerificationStats()),
      withLoading(() => getAdminTestLabStats()),
      withLoading(() => getAdminSystemHealth()),
    ]);
    if (s) setSummary(s.summary);
    if (ms) setMatchStats(ms);
    if (cs) setChatStats(cs);
    if (vs) setVerificationStats(vs);
    if (ts) setTestLabStats(ts);
    if (h) setHealth(h);
  }, [withLoading]);

  const fetchUsers = useCallback(async (cursor = "", query = "") => {
    const res = await withLoading(() => getAdminUsers(cursor, 20, query));
    if (res) {
      setUsers(res.users);
      setUsersNextCursor(res.next_cursor);
    }
  }, [withLoading]);

  const fetchMatches = useCallback(async (cursor = "") => {
    const res = await withLoading(() => getAdminMatches(cursor, 20));
    if (res) {
      setMatches(res.matches);
      setMatchesNextCursor(res.next_cursor);
    }
  }, [withLoading]);

  const fetchLeaderboard = useCallback(async (cursor = "") => {
    const res = await withLoading(() => getAdminLeaderboard(cursor, 50));
    if (res) {
      setLeaderboard(res.entries);
      setLbNextCursor(res.next_cursor);
    }
  }, [withLoading]);

  const fetchChat = useCallback(async () => {
    const [cs, cm] = await Promise.all([
      withLoading(() => getAdminChatStats()),
      withLoading(() => getAdminChatMessages(100)),
    ]);
    if (cs) setChatStats(cs);
    if (cm) setChatMessages(cm.messages);
  }, [withLoading]);

  const fetchVerification = useCallback(async () => {
    const [vs, vsl] = await Promise.all([
      withLoading(() => getAdminVerificationStats()),
      withLoading(() => getAdminVerificationSessions(50)),
    ]);
    if (vs) setVerificationStats(vs);
    if (vsl) setVerificationSessions(vsl.sessions);
  }, [withLoading]);

  const fetchTestLab = useCallback(async () => {
    const [ts, tsl] = await Promise.all([
      withLoading(() => getAdminTestLabStats()),
      withLoading(() => getAdminTestLabSessions(50)),
    ]);
    if (ts) setTestLabStats(ts);
    if (tsl) setTestLabSessions(tsl.sessions);
  }, [withLoading]);

  const fetchSounds = useCallback(async () => {
    const res = await withLoading(() => getAdminResultSounds());
    if (res) setSounds(res.sounds);
  }, [withLoading]);

  useEffect(() => {
    if (!storedSecret) return;
    if (activeTab === "overview") void fetchOverview();
    if (activeTab === "users") void fetchUsers();
    if (activeTab === "matches") void fetchMatches();
    if (activeTab === "leaderboard") void fetchLeaderboard();
    if (activeTab === "chat") void fetchChat();
    if (activeTab === "verification") void fetchVerification();
    if (activeTab === "testlab") void fetchTestLab();
    if (activeTab === "sounds") void fetchSounds();
    if (activeTab === "health") void fetchOverview();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, storedSecret]);

  const openUserDetail = useCallback(async (user: AdminUser) => {
    setSelectedUser(user);
    setRoleEditValue(user.role);
    setUserDetailLoading(true);
    try {
      const [um, urh] = await Promise.all([
        getAdminUserMatches(user.id),
        getAdminUserRatingHistory(user.id),
      ]);
      setUserMatches(um.matches);
      setUserRatingHistory(urh.history);
    } catch {
      // ignore
    } finally {
      setUserDetailLoading(false);
    }
  }, []);

  const handleRoleChange = useCallback(async () => {
    if (!selectedUser || !roleEditValue) return;
    setUserDetailLoading(true);
    try {
      await setAdminUserRole(selectedUser.id, roleEditValue);
      setSelectedUser((u) => u ? { ...u, role: roleEditValue } : null);
      // Refresh users list
      void fetchUsers();
    } catch {
      // ignore
    } finally {
      setUserDetailLoading(false);
    }
  }, [selectedUser, roleEditValue, fetchUsers]);

  if (!storedSecret) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-3"
        role="dialog"
        aria-modal="true"
        onMouseDown={onClose}
      >
        <div
          className="flex h-screen w-full flex-col overflow-hidden border-x-0 border-red-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(248,113,113,0.18)] sm:h-[calc(100vh-1.5rem)] sm:max-w-[500px] sm:border"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-lg font-black uppercase tracking-[0.14em] text-zinc-100">Admin Access</h2>
            <button className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-red-400 hover:text-white" onClick={onClose} type="button" aria-label="Close">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">
            <Shield className="h-12 w-12 text-red-400/60" />
            <div className="mt-4 text-sm font-black uppercase tracking-[0.14em] text-zinc-300">Authentication Required</div>
            <div className="mt-2 text-center text-[10px] uppercase tracking-[0.12em] text-zinc-600">Enter admin secret key to access dashboard</div>
            <div className="mt-6 w-full max-w-xs">
              <input type="password" value={secret} onChange={(e) => setSecretInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSecretSubmit()} placeholder="Secret key" className="w-full border border-zinc-800 bg-black px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-200 placeholder:text-zinc-700 focus:border-red-400 focus:outline-none" />
              {secretError && <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-red-400">{secretError}</div>}
              <button type="button" onClick={handleSecretSubmit} className="mt-3 inline-flex h-10 w-full items-center justify-center border border-red-500/50 bg-red-950/35 text-[10px] font-black uppercase tracking-[0.14em] text-red-100 transition-colors hover:border-red-300 hover:text-white">Authenticate</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tabs: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Overview", icon: <Activity className="h-3.5 w-3.5" /> },
    { key: "users", label: "Users", icon: <Users className="h-3.5 w-3.5" /> },
    { key: "matches", label: "Matches", icon: <Swords className="h-3.5 w-3.5" /> },
    { key: "leaderboard", label: "Top", icon: <Trophy className="h-3.5 w-3.5" /> },
    { key: "chat", label: "Chat", icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { key: "verification", label: "Verify", icon: <Shield className="h-3.5 w-3.5" /> },
    { key: "testlab", label: "Test Lab", icon: <Zap className="h-3.5 w-3.5" /> },
    { key: "sounds", label: "Sounds", icon: <Music className="h-3.5 w-3.5" /> },
    { key: "health", label: "Health", icon: <HeartPulse className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-3" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="flex h-screen w-full flex-col overflow-hidden border-x-0 border-red-500/35 bg-zinc-950 shadow-[0_0_40px_rgba(248,113,113,0.18)] sm:h-[calc(100vh-1.5rem)] sm:max-w-[1100px] sm:border" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-black uppercase tracking-[0.14em] text-zinc-100">Admin Dashboard</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleClearSecret} className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600 transition-colors hover:text-red-400">Logout</button>
            <button className="inline-flex h-10 w-10 items-center justify-center border border-zinc-800 bg-black/80 text-zinc-400 transition-colors hover:border-red-400 hover:text-white" onClick={onClose} type="button" aria-label="Close">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex overflow-x-auto border-b border-zinc-800">
          {tabs.map((tab) => (
            <button key={tab.key} type="button" onClick={() => { setActiveTab(tab.key); setSelectedUser(null); }} className={cn("inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors", activeTab === tab.key ? "border-red-400 text-red-300" : "border-transparent text-zinc-500 hover:text-zinc-300")}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {loading && <div className="flex h-32 items-center justify-center"><div className="h-8 w-8 animate-spin border-2 border-zinc-800 border-t-red-400" /></div>}
          {secretError && !loading && <div className="mb-4 border border-red-500/45 bg-red-950/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200">{secretError}</div>}

          {/* ─── OVERVIEW ─── */}
          {!loading && activeTab === "overview" && summary && (
            <div className="space-y-6">
              <SectionTitle icon={<Users className="h-3.5 w-3.5" />} title="Users" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Total Users" value={summary.total_users} />
                <StatCard label="Registered" value={summary.total_registered} />
                <StatCard label="Anonymous" value={summary.total_anonymous} />
                <StatCard label="Verified" value={summary.verified_users} />
              </div>

              <SectionTitle icon={<Swords className="h-3.5 w-3.5" />} title="Matches & Rating" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Total Matches" value={summary.total_matches} />
                <StatCard label="Matches Today" value={summary.matches_today} />
                <StatCard label="Avg Rating" value={summary.avg_rating.toFixed(0)} />
                <StatCard label="Top Rating" value={summary.top_rating} />
              </div>

              <SectionTitle icon={<MessageSquare className="h-3.5 w-3.5" />} title="Chat & Content" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Chat Messages" value={summary.total_chat_messages} />
                <StatCard label="Msgs Today" value={summary.chat_messages_today} />
                <StatCard label="TestLab Sessions" value={summary.test_lab_sessions} />
                <StatCard label="TestLab Today" value={summary.test_lab_sessions_today} />
              </div>

              <SectionTitle icon={<Music className="h-3.5 w-3.5" />} title="Sounds" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Result Sounds" value={summary.total_result_sounds} />
                <StatCard label="Sound Unlocks" value={summary.total_sound_unlocks} />
              </div>

              {matchStats && (
                <>
                  <SectionTitle icon={<BarChart3 className="h-3.5 w-3.5" />} title="Match Stats" />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <StatCard label="Matches" value={matchStats.stats.matches} />
                    <StatCard label="Draws" value={matchStats.stats.draws} />
                    <StatCard label="Disconnects" value={matchStats.stats.disconnect_finishes} />
                    <StatCard label="Avg Score" value={matchStats.stats.average_score.toFixed(2)} />
                    <StatCard label="Avg Duration" value={`${matchStats.stats.average_duration_sec}s`} />
                  </div>
                </>
              )}

              {chatStats && (
                <>
                  <SectionTitle icon={<MessageSquare className="h-3.5 w-3.5" />} title="Chat Stats" />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard label="Total Messages" value={chatStats.stats.total_messages} />
                    <StatCard label="Messages Today" value={chatStats.stats.messages_today} />
                    <StatCard label="Top Senders" value={chatStats.stats.top_senders.length} />
                  </div>
                  {chatStats.stats.top_senders.length > 0 && (
                    <div className="mt-3 flex flex-col gap-2">
                      {chatStats.stats.top_senders.map((s, i) => (
                        <div key={s.user_id} className="flex items-center justify-between border border-zinc-800 bg-black/40 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-zinc-600">#{i + 1}</span>
                            <span className="text-xs font-black uppercase tracking-[0.1em] text-zinc-300">{s.nickname}</span>
                          </div>
                          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">{s.messages} msgs</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {verificationStats && (
                <>
                  <SectionTitle icon={<Shield className="h-3.5 w-3.5" />} title="Verification Stats" />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard label="Total Sessions" value={verificationStats.stats.total_sessions} />
                    <StatCard label="Completed" value={verificationStats.stats.completed_sessions} />
                    <StatCard label="Pass Rate" value={`${verificationStats.stats.pass_rate.toFixed(1)}%`} />
                    <StatCard label="Issued Tokens" value={verificationStats.stats.issued_tokens} />
                    <StatCard label="Used Tokens" value={verificationStats.stats.used_tokens} />
                    <StatCard label="Consume Rate" value={`${verificationStats.stats.token_consume_rate.toFixed(1)}%`} />
                  </div>
                </>
              )}

              {testLabStats && (
                <>
                  <SectionTitle icon={<Zap className="h-3.5 w-3.5" />} title="Test Lab Stats" />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard label="Total Sessions" value={testLabStats.stats.total_sessions} />
                    <StatCard label="Sessions Today" value={testLabStats.stats.sessions_today} />
                    <StatCard label="Total Samples" value={testLabStats.stats.total_samples} />
                    <StatCard label="Avg Score" value={testLabStats.stats.average_final_score.toFixed(2)} />
                    <StatCard label="Completion" value={`${testLabStats.stats.completion_rate.toFixed(1)}%`} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── USERS ─── */}
          {!loading && activeTab === "users" && !selectedUser && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                  <input type="text" value={usersQuery} onChange={(e) => setUsersQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && fetchUsers("", usersQuery)} placeholder="Search users..." className="w-full border border-zinc-800 bg-black py-2 pl-8 pr-3 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-200 placeholder:text-zinc-700 focus:border-red-400 focus:outline-none" />
                </div>
                <button type="button" onClick={() => fetchUsers("", usersQuery)} className="inline-flex h-8 items-center border border-zinc-800 bg-black px-3 text-[9px] font-black uppercase tracking-[0.1em] text-zinc-400 transition-colors hover:border-red-400 hover:text-white">Search</button>
              </div>
              <div className="flex flex-col gap-2">
                {users.map((user) => (
                  <button key={user.id} type="button" onClick={() => openUserDetail(user)} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border border-zinc-800 bg-black/60 px-3 py-2 text-left transition-colors hover:border-zinc-600">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.1em] text-zinc-200">{user.nickname}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[9px] uppercase tracking-[0.08em] text-zinc-600">
                        <span>{user.id}</span>
                        <span className="text-zinc-700">·</span>
                        <span>{user.type}</span>
                        <span className={cn("border px-1 py-0.5 text-[7px] font-black uppercase", user.verification_status === "passed" ? "border-emerald-400/30 bg-emerald-950/30 text-emerald-300" : "border-zinc-700 bg-zinc-900 text-zinc-600")}>{user.verification_status}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black text-zinc-300">{user.rating}</div>
                      <div className="text-[8px] uppercase tracking-[0.1em] text-zinc-600">{user.rank}</div>
                    </div>
                    <div className="text-[9px] uppercase tracking-[0.08em] text-zinc-600">{user.matches}M</div>
                    <span className={cn("inline-flex border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.1em]", user.role === "admin" ? "border-red-400/40 bg-red-950/40 text-red-300" : "border-zinc-700 bg-zinc-900 text-zinc-500")}>{user.role}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button type="button" disabled={!usersCursor} onClick={() => fetchUsers(usersCursor, usersQuery)} className="inline-flex h-8 items-center gap-1 border border-zinc-800 bg-black px-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400 transition-colors hover:border-red-400 hover:text-white disabled:opacity-30">
                  <ChevronLeft className="h-3 w-3" /> Prev
                </button>
                <button type="button" disabled={!usersNextCursor} onClick={() => { setUsersCursor(usersNextCursor); fetchUsers(usersNextCursor, usersQuery); }} className="inline-flex h-8 items-center gap-1 border border-zinc-800 bg-black px-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400 transition-colors hover:border-red-400 hover:text-white disabled:opacity-30">
                  Next <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* ─── USER DETAIL ─── */}
          {!loading && activeTab === "users" && selectedUser && (
            <div className="space-y-4">
              <button type="button" onClick={() => setSelectedUser(null)} className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 transition-colors hover:text-zinc-300">
                <ChevronLeft className="h-3 w-3" /> Back to users
              </button>

              <div className="border border-zinc-800 bg-black/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-black uppercase tracking-[0.1em] text-zinc-100">{selectedUser.nickname}</div>
                    <div className="mt-1 text-[9px] uppercase tracking-[0.08em] text-zinc-600">{selectedUser.id} · {selectedUser.type}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-zinc-100">{selectedUser.rating}</div>
                    <div className="text-[9px] uppercase tracking-[0.1em] text-zinc-500">peak {selectedUser.peak_rating} · {selectedUser.rank}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="border border-zinc-800 bg-black/40 p-2 text-center">
                    <div className="text-sm font-black text-zinc-200">{selectedUser.matches}</div>
                    <div className="text-[8px] uppercase tracking-[0.1em] text-zinc-600">matches</div>
                  </div>
                  <div className="border border-zinc-800 bg-black/40 p-2 text-center">
                    <div className="text-sm font-black text-emerald-300">{selectedUser.wins}</div>
                    <div className="text-[8px] uppercase tracking-[0.1em] text-zinc-600">wins</div>
                  </div>
                  <div className="border border-zinc-800 bg-black/40 p-2 text-center">
                    <div className="text-sm font-black text-red-300">{selectedUser.losses}</div>
                    <div className="text-[8px] uppercase tracking-[0.1em] text-zinc-600">losses</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[9px] uppercase tracking-[0.1em] text-zinc-500">role:</span>
                  <input type="text" value={roleEditValue} onChange={(e) => setRoleEditValue(e.target.value)} className="w-24 border border-zinc-800 bg-black px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-200 focus:border-red-400 focus:outline-none" />
                  <button type="button" onClick={handleRoleChange} className="inline-flex h-6 items-center border border-red-500/40 bg-red-950/30 px-2 text-[8px] font-black uppercase tracking-[0.1em] text-red-200 transition-colors hover:border-red-300 hover:text-white">Save</button>
                </div>
                {selectedUser.selected_sound_title && (
                  <div className="mt-2 text-[9px] uppercase tracking-[0.1em] text-zinc-600">sound: <span className="text-zinc-400">{selectedUser.selected_sound_title}</span></div>
                )}
              </div>

              {userDetailLoading && <div className="flex h-20 items-center justify-center"><div className="h-6 w-6 animate-spin border-2 border-zinc-800 border-t-red-400" /></div>}

              {userRatingHistory.length > 0 && (
                <div>
                  <SectionTitle icon={<TrendingUp className="h-3.5 w-3.5" />} title="Rating History" />
                  <div className="flex flex-col gap-1">
                    {userRatingHistory.map((h, i) => (
                      <div key={i} className="flex items-center justify-between border border-zinc-800 bg-black/40 px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[10px] font-black", h.delta >= 0 ? "text-emerald-300" : "text-red-300")}>{h.delta >= 0 ? "+" : ""}{h.delta}</span>
                          <span className="text-[9px] text-zinc-500">{h.old_rating} → {h.new_rating}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[8px] uppercase tracking-[0.08em] text-zinc-600">{h.reason}</span>
                          <span className="ml-2 text-[8px] text-zinc-700">{new Date(h.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {userMatches.length > 0 && (
                <div>
                  <SectionTitle icon={<Swords className="h-3.5 w-3.5" />} title="Recent Matches" />
                  <div className="flex flex-col gap-1">
                    {userMatches.slice(0, 10).map((m) => (
                      <div key={m.match_id} className="flex items-center justify-between border border-zinc-800 bg-black/40 px-3 py-1.5">
                        <div className="text-xs font-black uppercase tracking-[0.08em] text-zinc-300">
                          {m.player_a_nickname} <span className="text-zinc-600">vs</span> {m.player_b_nickname}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[9px] font-black uppercase", m.result === "win" ? "text-emerald-300" : m.result === "loss" ? "text-red-300" : "text-zinc-500")}>{m.result}</span>
                          <span className="text-[8px] text-zinc-600">{m.rating_delta_a >= 0 ? "+" : ""}{m.rating_delta_a}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── MATCHES ─── */}
          {!loading && activeTab === "matches" && (
            <div>
              <div className="mb-3 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">Total matches</div>
              <div className="flex flex-col gap-1">
                {matches.map((m) => (
                  <div key={m.match_id} className="grid grid-cols-[1fr_auto] items-center gap-3 border border-zinc-800 bg-black/60 px-3 py-2">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.08em] text-zinc-200">
                        <span className={cn(m.winner_id === m.player_a_id && "text-emerald-300")}>{m.player_a_nickname}</span>
                        <span className="mx-1 text-zinc-600">vs</span>
                        <span className={cn(m.winner_id === m.player_b_id && "text-emerald-300")}>{m.player_b_nickname}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[9px] uppercase tracking-[0.08em] text-zinc-600">
                        <span className={cn("inline-flex border px-1 py-0.5 text-[7px] font-black uppercase", m.mode === "duel" ? "border-purple-400/30 bg-purple-950/30 text-purple-300" : "border-zinc-700 bg-zinc-900 text-zinc-500")}>{m.mode}</span>
                        <span>{m.started_at ? new Date(m.started_at).toLocaleDateString() : "—"}</span>
                        <span className="text-zinc-700">·</span>
                        <span>{m.finished_at ? `${Math.round((new Date(m.finished_at).getTime() - new Date(m.started_at).getTime()) / 1000)}s` : "ongoing"}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      {m.winner_id && (
                        <span className="text-[9px] font-black uppercase tracking-[0.1em] text-emerald-300">
                          {m.winner_id === m.player_a_id ? "A wins" : "B wins"}
                        </span>
                      )}
                      <div className="mt-0.5 text-[8px] text-zinc-600">
                        {m.player_a_score?.toFixed(2)} - {m.player_b_score?.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button type="button" disabled={!matchesCursor} onClick={() => fetchMatches(matchesCursor)} className="inline-flex h-8 items-center gap-1 border border-zinc-800 bg-black px-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400 transition-colors hover:border-red-400 hover:text-white disabled:opacity-30">
                  <ChevronLeft className="h-3 w-3" /> Prev
                </button>
                <button type="button" disabled={!matchesNextCursor} onClick={() => { setMatchesCursor(matchesNextCursor); fetchMatches(matchesNextCursor); }} className="inline-flex h-8 items-center gap-1 border border-zinc-800 bg-black px-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400 transition-colors hover:border-red-400 hover:text-white disabled:opacity-30">
                  Next <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* ─── LEADERBOARD ─── */}
          {!loading && activeTab === "leaderboard" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">Top Players</span>
              </div>
              <div className="flex flex-col gap-1">
                {leaderboard.map((entry, i) => (
                  <div key={entry.user_id} className={cn("flex items-center justify-between border px-3 py-2", i === 0 ? "border-amber-400/30 bg-amber-950/20" : i === 1 ? "border-zinc-400/30 bg-zinc-900/40" : i === 2 ? "border-orange-400/30 bg-orange-950/20" : "border-zinc-800 bg-black/40")}>
                    <div className="flex items-center gap-3">
                      <span className={cn("flex h-5 w-5 items-center justify-center text-[9px] font-black", i < 3 ? "text-zinc-200" : "text-zinc-600")}>#{entry.position}</span>
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.1em] text-zinc-200">{entry.nickname}</div>
                        <div className="text-[8px] uppercase tracking-[0.1em] text-zinc-600">{entry.rank}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-zinc-100">{entry.rating}</div>
                      <div className="text-[8px] text-zinc-600">peak {entry.peak_rating}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button type="button" disabled={!lbCursor} onClick={() => fetchLeaderboard(lbCursor)} className="inline-flex h-8 items-center gap-1 border border-zinc-800 bg-black px-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400 transition-colors hover:border-red-400 hover:text-white disabled:opacity-30">
                  <ChevronLeft className="h-3 w-3" /> Prev
                </button>
                <button type="button" disabled={!lbNextCursor} onClick={() => { setLbCursor(lbNextCursor); fetchLeaderboard(lbNextCursor); }} className="inline-flex h-8 items-center gap-1 border border-zinc-800 bg-black px-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400 transition-colors hover:border-red-400 hover:text-white disabled:opacity-30">
                  Next <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* ─── CHAT ─── */}
          {!loading && activeTab === "chat" && (
            <div className="space-y-4">
              {chatStats && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard label="Total Messages" value={chatStats.stats.total_messages} />
                  <StatCard label="Messages Today" value={chatStats.stats.messages_today} />
                  <StatCard label="Top Senders" value={chatStats.stats.top_senders.length} />
                </div>
              )}
              <SectionTitle icon={<MessageSquare className="h-3.5 w-3.5" />} title="Recent Messages" />
              <div className="flex flex-col gap-1">
                {chatMessages.map((msg) => (
                  <div key={msg.id} className="flex items-start justify-between border border-zinc-800 bg-black/40 px-3 py-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-[0.08em] text-zinc-300">{msg.sender_nickname}</span>
                      <div className="mt-0.5 text-xs text-zinc-400">{msg.text}</div>
                    </div>
                    <span className="shrink-0 text-[8px] text-zinc-700">{new Date(msg.created_at).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── VERIFICATION ─── */}
          {!loading && activeTab === "verification" && (
            <div className="space-y-4">
              {verificationStats && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard label="Total Sessions" value={verificationStats.stats.total_sessions} />
                  <StatCard label="Completed" value={verificationStats.stats.completed_sessions} />
                  <StatCard label="Pass Rate" value={`${verificationStats.stats.pass_rate.toFixed(1)}%`} />
                  <StatCard label="Issued Tokens" value={verificationStats.stats.issued_tokens} />
                  <StatCard label="Used Tokens" value={verificationStats.stats.used_tokens} />
                  <StatCard label="Consume Rate" value={`${verificationStats.stats.token_consume_rate.toFixed(1)}%`} />
                </div>
              )}
              <SectionTitle icon={<Shield className="h-3.5 w-3.5" />} title="Recent Sessions" />
              <div className="flex flex-col gap-1">
                {verificationSessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border border-zinc-800 bg-black/40 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.08em] text-zinc-400">{s.id}</div>
                    <div className="flex items-center gap-3 text-[9px] text-zinc-600">
                      <span>{s.blink_count} blinks</span>
                      <span>{s.completed_at ? "completed" : "pending"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── TEST LAB ─── */}
          {!loading && activeTab === "testlab" && (
            <div className="space-y-4">
              {testLabStats && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard label="Total Sessions" value={testLabStats.stats.total_sessions} />
                  <StatCard label="Sessions Today" value={testLabStats.stats.sessions_today} />
                  <StatCard label="Total Samples" value={testLabStats.stats.total_samples} />
                  <StatCard label="Avg Score" value={testLabStats.stats.average_final_score.toFixed(2)} />
                  <StatCard label="Completion" value={`${testLabStats.stats.completion_rate.toFixed(1)}%`} />
                </div>
              )}
              <SectionTitle icon={<Zap className="h-3.5 w-3.5" />} title="Recent Sessions" />
              <div className="flex flex-col gap-1">
                {testLabSessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border border-zinc-800 bg-black/40 px-3 py-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.08em] text-zinc-400">{s.room_id}</div>
                      <div className="text-[8px] text-zinc-600">owner: {s.owner_id}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black text-zinc-300">{s.final_average?.toFixed(2) ?? "—"}</div>
                      <div className="text-[8px] text-zinc-600">{s.samples_count} samples</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── SOUNDS ─── */}
          {!loading && activeTab === "sounds" && (
            <div>
              <div className="mb-3 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">Result Sounds</div>
              <div className="flex flex-col gap-2">
                {sounds.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border border-zinc-800 bg-black/60 px-3 py-2">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.1em] text-zinc-200">{s.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[9px] text-zinc-600">
                        <span>{s.owners_count} owners</span>
                        <span>{s.selected_count} selected</span>
                        {s.is_default && <span className="border border-zinc-700 px-1 text-[7px] text-zinc-500">default</span>}
                        {!s.is_active && <span className="border border-red-700 px-1 text-[7px] text-red-500">inactive</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── HEALTH ─── */}
          {!loading && activeTab === "health" && health && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className={cn("h-2 w-2", health.ok ? "bg-emerald-400" : "bg-red-400")} />
                <span className={cn("text-sm font-black uppercase tracking-[0.1em]", health.ok ? "text-emerald-300" : "text-red-300")}>
                  {health.ok ? "All Systems Operational" : "Some Services Down"}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(health.services).map(([name, svc]) => (
                  <div key={name} className={cn("flex items-center justify-between border px-3 py-2", svc.ok ? "border-emerald-400/20 bg-emerald-950/10" : "border-red-400/20 bg-red-950/10")}>
                    <div className="flex items-center gap-2">
                      <Server className={cn("h-3.5 w-3.5", svc.ok ? "text-emerald-400" : "text-red-400")} />
                      <span className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-300">{name}</span>
                    </div>
                    <div className="text-right">
                      <span className={cn("text-[9px] font-black uppercase", svc.ok ? "text-emerald-300" : "text-red-300")}>{svc.ok ? "OK" : "DOWN"}</span>
                      {svc.error && <div className="text-[8px] text-red-500">{svc.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
      <span className="text-zinc-500">{icon}</span>
      <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{title}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-zinc-800 bg-black/60 px-4 py-3">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums text-zinc-100">{value}</div>
    </div>
  );
}
