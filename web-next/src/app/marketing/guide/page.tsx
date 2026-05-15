import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Guide for SUB5 — Chadchat",
  description: "A comprehensive guide for SUB5 users on Chadchat.",
};

export default function GuidePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-zinc-100">
      <h1 className="text-2xl font-black uppercase tracking-[0.14em]">Guide for SUB5</h1>
      <div className="mt-8 space-y-6 text-sm leading-7 text-zinc-300">
        <p>Welcome to the SUB5 guide. Here you will learn how to improve your rating and climb the ranks.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">1. Understanding Your Score</h2>
        <p>Your score is calculated by AI based on facial symmetry, proportions, and other features.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">2. Test Lab</h2>
        <p>Use the Test Lab to get an accurate reading of your current score before entering ranked matches.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">3. 1v1 Mogging</h2>
        <p>Challenge other users in live 1v1 duels. Winner takes rating points from the loser.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">4. Leaderboard</h2>
        <p>Climb the leaderboard by winning matches and improving your average score.</p>
      </div>
    </main>
  );
}
