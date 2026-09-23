import type { Metadata } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'House Ranker',
  description: 'A shared, consistent way to compare and rank homes.',
  openGraph: {
    title: 'House Ranker',
    description: 'Compare homes around what matters.',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1733,
        height: 907,
        alt: 'House Ranker comparison table',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'House Ranker',
    description: 'Compare homes around what matters.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
