import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DevDeck — Mac & PC Coding Companion',
  description: 'OLED hardware macro deck, Antigravity IDE live mirror & PC/Mac Doctor for iPhone',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'DevDeck',
  },
  icons: {
    icon: [
      { url: '/icons/favicon-64.png', sizes: '64x64', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-black text-[#f2f3f7] antialiased selection:bg-cyan-500/30">
        {children}
      </body>
    </html>
  );
}
