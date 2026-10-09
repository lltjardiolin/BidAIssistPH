import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, Literata } from 'next/font/google';
import './globals.css';

// Literata was drawn for long reading on screens: it carries the answers. Hanken Grotesk carries the
// margin notes and the controls.
const literata = Literata({ subsets: ['latin'], weight: ['400', '500', '600'], style: ['normal', 'italic'], variable: '--font-literata', display: 'swap' });
const hanken = Hanken_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '800'], variable: '--font-hanken', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'BidAIssistPH — Philippine procurement law, with sources', template: '%s · BidAIssistPH' },
  description:
    'Ask about Philippine government procurement law. Answers come only from indexed official RA 9184, RA 12009, IRR and GPPB documents — with the exact source, version and status.',
  openGraph: {
    title: 'BidAIssistPH — Philippine procurement law, with sources',
    description:
      'Ask about Philippine government procurement law. Every answer is grounded in indexed official RA 9184, RA 12009, IRR and GPPB documents and cites the exact source, version and status.',
    siteName: 'BidAIssistPH',
    type: 'website',
    locale: 'en_PH',
  },
  twitter: { card: 'summary', title: 'BidAIssistPH', description: 'Philippine procurement law, answered with sources.' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#ECEAF2' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${literata.variable} ${hanken.variable}`}>
      <body>
        {/* Stamp ink: rough edges and a little unevenness, as a rubber stamp leaves on paper. */}
        <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
          <filter id="stamp-ink" x="-5%" y="-10%" width="110%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="grain" />
            <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.1" result="rough" />
            <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -5 3.9" result="gaps" />
            <feComposite in="rough" in2="gaps" operator="in" />
          </filter>
        </svg>
        {children}
      </body>
    </html>
  );
}
