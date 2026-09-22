import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "오늘의 진짜 정보판 — 데이터가 안 올 때",
  description: "비트코인 KRW 시세를 실시간으로 보여주고, 오류 시 값을 지어내지 않고 정직하게 상태를 표시하는 정보판",
  openGraph: {
    title: "오늘의 진짜 정보판",
    description: "데이터가 안 올 때, 값을 지어내지 않고 정직하게 보여줍니다.",
    type: "website",
    locale: "ko_KR",
  },
  twitter: {
    card: "summary",
    title: "오늘의 진짜 정보판",
    description: "데이터가 안 올 때, 값을 지어내지 않고 정직하게 보여줍니다.",
  },
};

export const viewport = {
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
