import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Compound Longevity 科学情报后台",
  description: "Longevity 科学日报自动抓取、排序、编辑和 Lark 推送后台",
  icons: {
    icon: "/icon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
