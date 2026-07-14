'use client';

import Link from 'next/link';

interface SiteHeaderProps {
  ctaHref?: string;
  ctaLabel?: string;
}

export function SiteHeader({ ctaHref = '/generate', ctaLabel = 'Generate your stack →' }: SiteHeaderProps) {
  return (
    <header className="border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur-sm z-50">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <img
            src="/enlight-labs-logo.png"
            alt="Enlight Lab"
            width={32}
            height={32}
            className="h-8 w-auto object-contain"
          />
          <span className="text-xl font-bold tracking-tight text-indigo-600 font-sans">
            Enlight Lab
          </span>
        </Link>
        <Link href={ctaHref} className="text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg transition-colors no-underline">
          {ctaLabel}
        </Link>
      </div>
    </header>
  );
}
