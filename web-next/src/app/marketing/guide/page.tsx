import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How to Play — Chadchat",
  description: "Complete guide on how to play Chadchat: face rating, 1v1 duels, Test Lab, and climbing the leaderboard.",
};

export default function GuidePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-zinc-100">
      <h1 className="text-2xl font-black uppercase tracking-[0.14em]">How to Play</h1>
      <div className="mt-8 space-y-8 text-sm leading-7 text-zinc-300">

        <p className="text-zinc-400">
          Chadchat is a live face-rating platform where AI scores your looks in real time. 
          Get rated, challenge others in 1v1 mogging duels, and climb the global leaderboard.
        </p>

        {/* ─── TEST LAB ─── */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">1. Test Lab — Get Your Score</h2>
          <p>
            Before jumping into ranked matches, use the <strong>Test Lab</strong> to get an accurate AI reading of your face.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-400">
            <li>Click <strong>"Start Test Lab"</strong> on the main screen</li>
            <li>Allow camera access — your video is processed locally by the AI model</li>
            <li>Hold your face steady for <strong>60 seconds</strong> while the AI captures frames</li>
            <li>Your <strong>final average score</strong> (0–10) appears at the end</li>
            <li>You can run Test Lab unlimited times — only your best score counts for confidence</li>
          </ul>
          <p className="text-zinc-500">
            Tip: Good lighting, front-facing camera, and neutral expression give the most accurate results.
          </p>
        </section>

        {/* ─── 1V1 DUEL ─── */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">2. 1v1 Mogging — Live Duels</h2>
          <p>
            Challenge real players or bots in <strong>live 1v1 face rating duels</strong>. Winner takes rating points from the loser.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-400">
            <li>Click <strong>"1v1 Mogging"</strong> to enter the matchmaking queue</li>
            <li>The system finds an opponent (real player or bot after 10s wait)</li>
            <li>Allow camera + microphone — WebRTC connects you directly to your opponent</li>
            <li>Both players must confirm <strong>media ready</strong> before the match starts</li>
          </ul>

          <h3 className="mt-4 text-sm font-bold uppercase tracking-[0.1em] text-zinc-300">Match Phases</h3>
          <div className="space-y-2 border-l-2 border-purple-500/30 pl-4">
            <div>
              <span className="font-black text-sky-300">Syncing</span>
              <span className="text-zinc-500"> — Waiting for both cameras to connect</span>
            </div>
            <div>
              <span className="font-black text-purple-300">Lock In</span>
              <span className="text-zinc-500"> — Facial lock acquired, get ready</span>
            </div>
            <div>
              <span className="font-black text-red-300">Analyzing</span>
              <span className="text-zinc-500"> — AI scores both players in real time for 10 seconds</span>
            </div>
            <div>
              <span className="font-black text-amber-300">Sudden Death</span>
              <span className="text-zinc-500"> — Tie-breaker round if scores are within 0.08</span>
            </div>
            <div>
              <span className="font-black text-yellow-300">Final Verdict</span>
              <span className="text-zinc-500"> — Winner revealed, rating points transferred</span>
            </div>
          </div>

          <h3 className="mt-4 text-sm font-bold uppercase tracking-[0.1em] text-zinc-300">Scoring</h3>
          <ul className="ml-4 list-disc space-y-1 text-zinc-400">
            <li>AI analyzes your face every second during the active phase</li>
            <li>Your <strong>running average</strong> updates in real time on screen</li>
            <li>Final score = average of all frames captured during the duel</li>
            <li>Winner = player with higher final score</li>
            <li>Rating delta depends on the score gap and both players' current ratings</li>
          </ul>

          <h3 className="mt-4 text-sm font-bold uppercase tracking-[0.1em] text-zinc-300">Bots</h3>
          <p className="text-zinc-400">
            If no real opponent is found within <strong>10 seconds</strong>, a bot is automatically assigned. 
            Bots have pre-recorded video and send scores automatically. You still earn full rating points for bot wins.
          </p>
        </section>

        {/* ─── RATING & RANKS ─── */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">3. Rating & Ranks</h2>
          <p>
            Every player has a <strong>rating</strong> that changes based on duel results. Higher rating = higher rank.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-400">
            <li>Start with <strong>1000 rating</strong> after registration</li>
            <li>Win duels to gain rating, lose duels to lose rating</li>
            <li>Your <strong>peak rating</strong> is recorded separately — it never decreases</li>
            <li>Ranks update automatically as you cross rating thresholds</li>
          </ul>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {[
              ["Bronze", "1000–1199"],
              ["Silver", "1200–1399"],
              ["Gold", "1400–1599"],
              ["Platinum", "1600–1799"],
              ["Diamond", "1800–1999"],
              ["Master", "2000+"],
            ].map(([rank, range]) => (
              <div key={rank} className="border border-zinc-800 bg-black/40 px-3 py-2">
                <span className="font-black uppercase tracking-[0.08em] text-zinc-200">{rank}</span>
                <span className="ml-2 text-zinc-600">{range}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ─── LEADERBOARD ─── */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">4. Leaderboard</h2>
          <p>
            The <strong>global leaderboard</strong> shows the top-rated players. Climb it by winning duels and maintaining a high average score.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-400">
            <li>Top 3 positions get special <strong>gradient text</strong> highlighting</li>
            <li>Leaderboard updates in real time after every match</li>
            <li>Click any player's name to view their public profile</li>
            <li>Pagination at the bottom — browse beyond the top 20</li>
          </ul>
        </section>

        {/* ─── VERIFICATION ─── */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">5. Webcam Verification</h2>
          <p>
            Verified users get a badge and unlock full platform features. Verification proves you are a real person.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-400">
            <li>Click your profile → <strong>"Verify"</strong></li>
            <li>Complete the liveness check: <strong>3 blinks + turn left + turn right</strong></li>
            <li>AI tracks your face landmarks in real time to confirm you're real</li>
            <li>Once passed, you get the <strong>verified badge</strong> permanently</li>
          </ul>
        </section>

        {/* ─── CHAT ─── */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">6. Live Chat</h2>
          <p>
            Talk to other players in the <strong>global live chat</strong>. Real-time messages, no refresh needed.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-400">
            <li>Type your message and hit Enter or click Send</li>
            <li>Admins have a red <strong>ADMIN</strong> badge next to their name</li>
            <li>Click any user's avatar or name to open their profile</li>
            <li>Chat history loads automatically when you join</li>
          </ul>
        </section>

        {/* ─── RESULT SOUNDS ─── */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">7. Result Sounds</h2>
          <p>
            Customize the sound that plays when you win a duel. Unlock new sounds as you progress.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-400">
            <li>Open <strong>Customize</strong> from the main menu</li>
            <li>Browse available result sounds</li>
            <li>Some sounds are unlocked by default, others require rating milestones</li>
            <li>Your selected sound plays automatically on victory</li>
          </ul>
        </section>

        {/* ─── TIPS ─── */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-200">8. Pro Tips</h2>
          <div className="space-y-2 border border-zinc-800 bg-black/40 p-4">
            <p className="text-zinc-400"><strong className="text-zinc-200">Lighting:</strong> Face the light source. Backlighting destroys your score.</p>
            <p className="text-zinc-400"><strong className="text-zinc-200">Angle:</strong> Front-facing camera, eye level. Tilted angles reduce symmetry score.</p>
            <p className="text-zinc-400"><strong className="text-zinc-200">Distance:</strong> Face should fill ~60% of the frame. Too far = lost detail.</p>
            <p className="text-zinc-400"><strong className="text-zinc-200">Expression:</strong> Neutral, relaxed face scores highest. Forced smiles lower proportions.</p>
            <p className="text-zinc-400"><strong className="text-zinc-200">Stability:</strong> Hold still during scoring. Movement blurs frames.</p>
            <p className="text-zinc-400"><strong className="text-zinc-200">Queue:</strong> If queue takes too long, a bot will auto-join after 10s. Free rating.</p>
          </div>
        </section>

      </div>
    </main>
  );
}
