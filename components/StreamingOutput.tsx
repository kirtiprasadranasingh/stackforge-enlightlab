'use client';

interface StreamingOutputProps {
  isGenerating: boolean;
}

export function StreamingOutput({ isGenerating }: StreamingOutputProps) {
  const dots = Array.from({ length: 3 }, (_, i) => i);

  return (
    <div className="card p-4 bg-blue-50/50 border-[var(--primary-blue)]">
      <div className="flex items-center justify-center gap-2 text-[var(--primary-blue)]">
        <div className="flex gap-1">
          {dots.map((_, i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-[var(--primary-blue)] animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
        <span className="font-medium">
          {isGenerating ? 'Generating infrastructure stack...' : 'Generating...'}
        </span>
      </div>

      <div className="mt-3">
        <div className="progress-track">
          <div className="progress-fill-blue h-full animate-pulse" style={{ width: isGenerating ? '60%' : '0%' }} />
        </div>
        <p className="text-xs text-[var(--muted-text)] mt-2">
          Streaming code in real-time...
        </p>
      </div>

      {isGenerating && (
        <div className="mt-3 text-xs text-[var(--muted-text)]">
          <p>✓ Presets applied</p>
          <p>✓ Generating Terraform</p>
          <p>✓ Creating CI/CD pipeline</p>
          <p>✓ Building manifests</p>
        </div>
      )}
    </div>
  );
}
