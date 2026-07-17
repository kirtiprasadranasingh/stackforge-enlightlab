'use client';

import Link from 'next/link';
import { BrandLockup } from '@/components/BrandLockup';

interface SiteHeaderProps {
  ctaHref?: string;
  ctaLabel?: string;
}

export function SiteHeader({ ctaHref = '/generate', ctaLabel = 'Generate your stack →' }: SiteHeaderProps) {
  return (
    <header className="border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur-sm z-50">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <BrandLockup tagline="AI CLOUD BLUEPRINT GENERATOR" />
        <Link href={ctaHref} className="text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg transition-colors no-underline">
          {ctaLabel}
        </Link>
      </div>
    </header>
  );
}
