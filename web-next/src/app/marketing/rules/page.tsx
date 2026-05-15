import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rules — Chadchat",
  description: "Community rules and guidelines for Chadchat users.",
};

export default function RulesPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-zinc-100">
      <h1 className="text-2xl font-black uppercase tracking-[0.14em]">Rules</h1>
      <div className="mt-8 space-y-6 text-sm leading-7 text-zinc-300">
        <p>Welcome to Chadchat. By using our platform, you agree to follow these rules.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">1. Be Respectful</h2>
        <p>Treat all users with respect. Harassment and hate speech are prohibited.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">2. No NSFW Content</h2>
        <p>Explicit content is not allowed anywhere on the platform.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">3. No Cheating</h2>
        <p>Bots and automation to manipulate ratings are forbidden.</p>
        <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">4. Age Requirement</h2>
        <p>You must be at least 18 years old to use Chadchat.</p>
      </div>
    </main>
  );
}
