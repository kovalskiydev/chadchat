import type { Metadata } from "next";
import { Inter, Press_Start_2P } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const pressStart2P = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-press-start",
});

export const metadata: Metadata = {
  title: "Chadchat — Live Face Rating & 1v1 Mogging",
  description:
    "Chadchat is the ultimate face rating platform. Get your looks scored by AI, climb the leaderboard, and challenge others in live 1v1 mogging duels.",
  keywords: [
    "face rating",
    "looksmaxing",
    "mogging",
    "1v1 duel",
    "AI scoring",
    "attractiveness rating",
    "chadchat",
    "sub5",
    "looksmax",
  ],
  authors: [{ name: "Chadchat" }],
  openGraph: {
    title: "Chadchat — Live Face Rating & 1v1 Mogging",
    description:
      "Get your looks scored by AI, climb the leaderboard, and challenge others in live 1v1 mogging duels.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Chadchat — Live Face Rating & 1v1 Mogging",
    description:
      "Get your looks scored by AI, climb the leaderboard, and challenge others in live 1v1 mogging duels.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${pressStart2P.variable} h-full antialiased`}>
      <head>
        <link rel="preconnect" href="https://api.chadchat.fun" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-1E7F3ZKB2S" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-1E7F3ZKB2S');
            `,
          }}
        />
      </head>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
