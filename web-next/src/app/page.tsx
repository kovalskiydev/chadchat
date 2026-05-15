import type { Metadata } from "next";
import HomePage from "@/components/home-page";

export const metadata: Metadata = {
  title: "Chadchat — Live Face Rating & 1v1 Mogging",
  description:
    "Chadchat is the ultimate face rating platform. Get your looks scored by AI, climb the leaderboard, and challenge others in live 1v1 mogging duels.",
};

export default function Home() {
  return <HomePage />;
}
