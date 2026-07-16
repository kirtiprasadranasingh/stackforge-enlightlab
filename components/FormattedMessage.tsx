import React from 'react';

interface FormattedMessageProps {
  content: string;
  className?: string;
}

export function FormattedMessage({ content, className }: FormattedMessageProps) {
  if (!content) return null;

  // Split content by newlines
  const lines = content.split('\n');

  return (
    <div className="space-y-1.5 font-sans leading-relaxed text-sm">
      {lines.map((line, idx) => {
        let trimmed = line.trim();

        // 1. Handle Bullet Points (e.g. starting with "* " or "- ")
        const isBullet = trimmed.startsWith('*') || trimmed.startsWith('-');
        if (isBullet) {
          // Remove the bullet marker
          trimmed = trimmed.replace(/^[\*\-\s]+/, '');
        }

        // 2. Parse inline bold (**bold**)
        const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
        const parsedContent = parts.map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            const isWhiteText = className?.includes('text-white');
            return (
              <strong
                key={pIdx}
                className={`font-extrabold rounded px-1 ${
                  isWhiteText
                    ? 'text-white bg-white/20'
                    : 'text-[#0066FF] bg-blue-50/50'
                }`}
              >
                {part.slice(2, -2)}
              </strong>
            );
          }
          return part;
        });

        // 3. Render line
        if (isBullet) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-3.5 mt-1 animate-fade-slide-up">
              <span className="text-[#0066FF] font-extrabold select-none">•</span>
              <span className={`flex-1 ${className || 'text-gray-700'}`}>{parsedContent}</span>
            </div>
          );
        }

        if (trimmed === '') {
          return <div key={idx} className="h-1.5" />;
        }

        return (
          <p key={idx} className={className || 'text-gray-700'}>
            {parsedContent}
          </p>
        );
      })}
    </div>
  );
}
