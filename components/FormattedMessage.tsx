import React from 'react';

interface FormattedMessageProps {
  content: string;
  className?: string;
}

function cleanMessageContent(content: string): string {
  if (!content) return '';
  let cleaned = content;
  // 1. Remove <<<FILE ...>>> ... <<<END_FILE>>> blocks
  cleaned = cleaned.replace(/<<<FILE[\s\S]*?>>>[\s\S]*?<<<END_FILE>>>/g, '');
  cleaned = cleaned.replace(/<<<FILE[\s\S]*?>>>[\s\S]*?$/g, ''); // strip partial files at stream end
  // 2. Remove other <<<...>>> markers
  cleaned = cleaned.replace(/<<<(STATUS|SUMMARY|WARNINGS|DELETE)[^>]*>>>/g, '');
  cleaned = cleaned.replace(/<<<END_[A-Z]+>>>/g, '');
  // 3. Remove markdown code blocks
  cleaned = cleaned.replace(/```[a-zA-Z0-9_-]*\r?\n[\s\S]*?\r?\n```/g, '');
  cleaned = cleaned.replace(/```[a-zA-Z0-9_-]*\r?\n[\s\S]*?$/g, ''); // strip partial code blocks
  // 4. Remove standalone fences
  cleaned = cleaned.replace(/```/g, '');
  return cleaned.trim();
}

export function FormattedMessage({ content, className }: FormattedMessageProps) {
  const cleanedContent = cleanMessageContent(content);
  if (!cleanedContent) return null;

  // Split content by newlines
  const lines = cleanedContent.split('\n');

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
