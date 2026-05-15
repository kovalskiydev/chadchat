import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Chadchat",
  description: "How Chadchat collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-zinc-100">
      <h1 className="text-2xl font-black uppercase tracking-[0.14em]">Privacy Policy</h1>
      <div className="mt-8 space-y-6 text-sm leading-7 text-zinc-300">
        <p>Last updated: May 2026</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">1. Data We Collect</h2>
        <p>We collect your nickname, facial scan data for verification, match history, and chat messages.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">2. How We Use Data</h2>
        <p>Your data is used for authentication, matchmaking, leaderboard rankings, and platform moderation.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">3. Data Retention</h2>
        <p>We retain your data as long as your account is active. You can request deletion at any time.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">4. Cookies</h2>
        <p>We use cookies for authentication and session management only.</p>
      </div>
    </main>
  );
}
