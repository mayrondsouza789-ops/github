import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ProgressCheck | Hair progress workspace",
  description: "Track photo check-ins, explore experimental on-device hair segmentation, and try a demonstration review workflow.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
