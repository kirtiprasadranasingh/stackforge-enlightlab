import Link from 'next/link';

/** Enlight Lab brand lockup — matches ai-mvp.enlightlab.com proportions */
export function BrandLockup({
  href = '/',
  tagline = 'AI CLOUD BLUEPRINT GENERATOR',
}: {
  href?: string;
  tagline?: string;
}) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 no-underline select-none">
      <img
        src="/enlight-labs-logo.png"
        alt="Enlight Lab"
        width={40}
        height={40}
        className="h-10 w-auto object-contain shrink-0 block"
      />
      <div className="flex flex-col justify-center leading-none">
        <span className="text-xl font-bold tracking-tight text-[#2563EB] font-sans" style={{ color: '#2563EB' }}>
          Enlight Lab
        </span>
        <span className="text-[7px] font-extrabold tracking-[0.16em] uppercase text-black font-sans mt-0.5">
          {tagline}
        </span>
      </div>
    </Link>
  );
}
