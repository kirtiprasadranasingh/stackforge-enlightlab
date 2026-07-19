'use client';

import { useMemo, useState } from 'react';
import {
  HOSTING_OPTIONS_BY_CLOUD,
  adaptClarifyingQuestions,
  baseCloudFromSetupQuestion,
  cloudFromInterviewAnswer,
} from '@/lib/clarifying-questions';

interface ClarifyingInterviewProps {
  questions: string[];
  answers: Record<number, string>;
  disabled?: boolean;
  onAnswer: (questionIndex: number, answer: string) => void;
  onSubmit: () => void;
}

type FollowUp = {
  prompt: string;
  options: string[];
};

const CLOUD_FOLLOW_UP: FollowUp = {
  prompt: 'Which cloud do you want to use instead?',
  options: [
    'AWS',
    'Microsoft Azure',
    'Google Cloud',
    'Oracle Cloud Infrastructure',
  ],
};

const CI_FOLLOW_UP: FollowUp = {
  prompt: 'Which CI/CD system do you want instead?',
  options: [
    'GitHub Actions',
    'GitLab CI',
    'Jenkins',
    'Azure DevOps Pipelines',
  ],
};

const DATA_FOLLOW_UP: FollowUp = {
  prompt: 'Which data service do you need?',
  options: ['MongoDB', 'Redis cache', 'Message queue', 'Other'],
};

const ALL_HOSTING_OPTIONS = [
  'Amazon EKS',
  'Amazon ECS',
  'Azure Kubernetes Service (AKS)',
  'Azure Container Apps',
  'Google Kubernetes Engine (GKE)',
  'Google Cloud Run',
  'Oracle Kubernetes Engine (OKE)',
];

function hostingOptionsForCloud(cloudLabel: string | null): string[] {
  const cloud = cloudFromInterviewAnswer(
    cloudLabel ? `Change the cloud: ${cloudLabel}` : undefined
  );
  if (cloud) return HOSTING_OPTIONS_BY_CLOUD[cloud];
  return ALL_HOSTING_OPTIONS;
}

export function parseClarifyingQuestion(raw: string): {
  prompt: string;
  options: string[];
} {
  const match = raw.match(/^([\s\S]*?)\s*\(options:\s*([\s\S]*?)\)\s*$/i);
  if (!match) return { prompt: raw, options: [] };

  return {
    prompt: match[1].trim(),
    options: match[2]
      .split(/\s+\/\s+/)
      .map((option) => option.trim())
      .filter(Boolean),
  };
}

function parseStructuredAnswer(
  answer: string,
  options: string[]
): { selectedOption: string | null; detail: string } {
  if (!answer.trim()) return { selectedOption: null, detail: '' };

  const direct = options.find((option) => option === answer);
  if (direct) return { selectedOption: direct, detail: '' };

  const withDetail = options.find((option) => answer.startsWith(`${option}:`));
  if (withDetail) {
    return {
      selectedOption: withDetail,
      detail: answer.slice(withDetail.length + 1).trim(),
    };
  }

  return { selectedOption: null, detail: answer };
}

/** Parse "Change the cloud: GCP | Hosting: GKE" style compound answers. */
function parseCompoundDetail(detail: string): {
  primary: string;
  hosting: string;
} {
  const parts = detail.split(/\s*\|\s*/).map((part) => part.trim());
  const hostingPart = parts.find((part) => /^Hosting:\s*/i.test(part));
  const primaryParts = parts.filter((part) => !/^Hosting:\s*/i.test(part));
  return {
    primary: primaryParts.join(' | ').trim(),
    hosting: hostingPart ? hostingPart.replace(/^Hosting:\s*/i, '').trim() : '',
  };
}

function OptionCards({
  options,
  selected,
  disabled,
  onSelect,
}: {
  options: string[];
  selected: string | null;
  disabled?: boolean;
  onSelect: (option: string) => void;
}) {
  return (
    <div className="mt-3 grid min-w-0 grid-cols-1 gap-2">
      {options.map((option, optionIndex) => {
        const isSelected = selected === option;
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={() => onSelect(option)}
            className={`group flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
              isSelected
                ? 'border-indigo-600 bg-indigo-50 text-indigo-950 ring-1 ring-indigo-600'
                : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:bg-indigo-50/60'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                isSelected
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-gray-300 bg-white text-gray-500 group-hover:border-indigo-300 group-hover:text-indigo-600'
              }`}
              aria-hidden
            >
              {String.fromCharCode(65 + optionIndex)}
            </span>
            <span className="min-w-0 flex-1 whitespace-normal break-words text-[11px] font-semibold leading-4">
              {option}
            </span>
            {isSelected && (
              <svg
                className="h-4 w-4 shrink-0 text-indigo-600"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M16.704 5.292a1 1 0 0 1 .004 1.414l-7.1 7.14a1 1 0 0 1-1.42 0l-3.896-3.92a1 1 0 1 1 1.416-1.412l3.186 3.204 6.392-6.43a1 1 0 0 1 1.418.004Z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FollowUpPanel({
  prompt,
  hint,
  options,
  selected,
  disabled,
  onSelect,
}: {
  prompt: string;
  hint: string;
  options: string[];
  selected: string | null;
  disabled?: boolean;
  onSelect: (option: string) => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
      <p className="text-[12px] font-semibold leading-relaxed text-indigo-950">
        {prompt}
      </p>
      <p className="mt-1 text-[10px] text-indigo-700">{hint}</p>
      <OptionCards
        options={options}
        selected={selected}
        disabled={disabled}
        onSelect={onSelect}
      />
    </div>
  );
}

export function ClarifyingInterview({
  questions,
  answers,
  disabled = false,
  onAnswer,
  onSubmit,
}: ClarifyingInterviewProps) {
  const [step, setStep] = useState(0);
  const [isAdvancing, setIsAdvancing] = useState(false);

  const effectiveQuestions = useMemo(
    () => adaptClarifyingQuestions(questions, answers),
    [questions, answers]
  );

  if (!effectiveQuestions.length) return null;

  const currentIndex = Math.min(step, effectiveQuestions.length - 1);
  const { prompt, options } = parseClarifyingQuestion(
    effectiveQuestions[currentIndex]
  );
  const currentAnswer = answers[currentIndex] || '';
  const { selectedOption, detail } = parseStructuredAnswer(currentAnswer, options);
  const { primary: followUpPrimary, hosting: followUpHosting } =
    parseCompoundDetail(detail);

  const isCloudChange = selectedOption === 'Change the cloud';
  const isHostingChange = selectedOption === 'Change the hosting platform';
  const isCiChange = selectedOption === 'Change CI/CD';
  const isDataOther = selectedOption === 'Another service';

  // Keep 'Change the hosting platform' within the cloud proposed in question 1
  // so we never mix, e.g., Oracle OKE compute with a Google Cloud SQL database.
  const baseCloud = baseCloudFromSetupQuestion(effectiveQuestions[0]);
  const hostingChangeOptions = baseCloud
    ? HOSTING_OPTIONS_BY_CLOUD[baseCloud]
    : ALL_HOSTING_OPTIONS;

  const cloudChoice = isCloudChange
    ? CLOUD_FOLLOW_UP.options.find((option) => option === followUpPrimary) ||
      null
    : null;
  const hostingChoice = isCloudChange
    ? followUpHosting || null
    : isHostingChange
      ? hostingChangeOptions.find((option) => option === followUpPrimary) || null
      : null;
  const ciChoice = isCiChange
    ? CI_FOLLOW_UP.options.find((option) => option === followUpPrimary) || null
    : null;
  const dataChoice = isDataOther
    ? DATA_FOLLOW_UP.options.find((option) => option === followUpPrimary) ||
      (followUpPrimary && !DATA_FOLLOW_UP.options.includes(followUpPrimary)
        ? 'Other'
        : null)
    : null;

  const hostingOptions = isCloudChange
    ? hostingOptionsForCloud(cloudChoice)
    : ALL_HOSTING_OPTIONS;

  const needsOtherText =
    isDataOther &&
    (dataChoice === 'Other' ||
      Boolean(followUpPrimary && !DATA_FOLLOW_UP.options.includes(followUpPrimary)));

  const answerComplete = (() => {
    if (isCloudChange) {
      return Boolean(cloudChoice && followUpHosting);
    }
    if (isHostingChange) {
      return Boolean(hostingChoice);
    }
    if (isCiChange) {
      return Boolean(ciChoice);
    }
    if (isDataOther) {
      return Boolean(followUpPrimary.trim()) && followUpPrimary !== 'Other';
    }
    return Boolean(selectedOption) || Boolean(currentAnswer.trim());
  })();

  const canContinue = answerComplete && !disabled && !isAdvancing;
  const isLast = currentIndex >= effectiveQuestions.length - 1;

  const answeredCount = effectiveQuestions.reduce((count, question, index) => {
    const answer = answers[index]?.trim() || '';
    if (!answer) return count;
    const { options: questionOptions } = parseClarifyingQuestion(question);
    const parsed = parseStructuredAnswer(answer, questionOptions);
    if (parsed.selectedOption === 'Change the cloud') {
      const compound = parseCompoundDetail(parsed.detail);
      return compound.primary && compound.hosting ? count + 1 : count;
    }
    if (
      parsed.selectedOption === 'Change the hosting platform' ||
      parsed.selectedOption === 'Change CI/CD' ||
      parsed.selectedOption === 'Another service'
    ) {
      return parsed.detail && parsed.detail !== 'Other' ? count + 1 : count;
    }
    return count + 1;
  }, 0);

  const clearStaleRegionIfNeeded = (nextCloudAnswer: string) => {
    const regionIndex = effectiveQuestions.findIndex((question) =>
      /^Where should we host it\?/i.test(question)
    );
    if (regionIndex < 0) return;
    const cloud = cloudFromInterviewAnswer(nextCloudAnswer);
    if (!cloud) return;
    const regions = adaptClarifyingQuestions(questions, {
      ...answers,
      [currentIndex]: nextCloudAnswer,
    });
    const regionQuestion = regions[regionIndex];
    const allowed = parseClarifyingQuestion(regionQuestion).options;
    const currentRegion = answers[regionIndex];
    if (currentRegion && !allowed.includes(currentRegion)) {
      onAnswer(regionIndex, '');
    }
  };

  const selectPrimary = (option: string) => {
    onAnswer(currentIndex, option);
  };

  const selectCloudFollowUp = (option: string) => {
    if (!selectedOption) return;
    const next = `${selectedOption}: ${option}`;
    onAnswer(currentIndex, next);
    clearStaleRegionIfNeeded(next);
  };

  const selectHostingAfterCloud = (option: string) => {
    if (!selectedOption || !cloudChoice) return;
    const next = `${selectedOption}: ${cloudChoice} | Hosting: ${option}`;
    onAnswer(currentIndex, next);
    clearStaleRegionIfNeeded(next);
  };

  const selectHostingFollowUp = (option: string) => {
    if (!selectedOption) return;
    onAnswer(currentIndex, `${selectedOption}: ${option}`);
  };

  const selectCiFollowUp = (option: string) => {
    if (!selectedOption) return;
    onAnswer(currentIndex, `${selectedOption}: ${option}`);
  };

  const selectDataFollowUp = (option: string) => {
    if (!selectedOption) return;
    if (option === 'Other') {
      onAnswer(currentIndex, `${selectedOption}: Other`);
      return;
    }
    onAnswer(currentIndex, `${selectedOption}: ${option}`);
  };

  const goNext = () => {
    if (!canContinue) return;

    if (isLast) {
      onSubmit();
      return;
    }

    setIsAdvancing(true);
    window.setTimeout(() => {
      setStep((value) => Math.min(value + 1, effectiveQuestions.length - 1));
      setIsAdvancing(false);
    }, 700);
  };

  const continueHint = (() => {
    if (isCloudChange && !cloudChoice) return 'Select a cloud first';
    if (isCloudChange && cloudChoice && !followUpHosting) {
      return 'Select a hosting platform first';
    }
    if (isHostingChange && !hostingChoice) return 'Select a hosting platform first';
    if (isCiChange && !ciChoice) return 'Select a CI/CD option first';
    if (isDataOther && !followUpPrimary.trim()) return 'Select a data service first';
    if (isDataOther && followUpPrimary === 'Other') return 'Type the service name first';
    return null;
  })();

  return (
    <section
      className="min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-white p-4"
      aria-labelledby="requirements-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="requirements-heading" className="text-xs font-bold text-gray-900">
            Question {currentIndex + 1} of {effectiveQuestions.length}
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            Choose one option. If you pick a change, we ask short follow-ups so the
            plan matches what you need.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
          {answeredCount}/{effectiveQuestions.length}
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all duration-300"
          style={{
            width: `${((currentIndex + (answerComplete ? 1 : 0)) / effectiveQuestions.length) * 100}%`,
          }}
        />
      </div>

      {isAdvancing ? (
        <div
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-4 text-[11px] font-medium text-indigo-700"
          role="status"
        >
          <span className="loading-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          Got it — preparing the next question…
        </div>
      ) : (
        <div
          role="group"
          aria-labelledby="clarify-current-question"
          className="min-w-0 rounded-2xl border border-gray-200 bg-gray-50/50 p-3.5"
        >
          <p
            id="clarify-current-question"
            className="min-w-0 break-words text-[13px] font-semibold leading-relaxed text-gray-900"
          >
            {prompt}
          </p>

          <OptionCards
            options={options}
            selected={selectedOption}
            disabled={disabled}
            onSelect={selectPrimary}
          />

          {isCloudChange && (
            <>
              <FollowUpPanel
                prompt={CLOUD_FOLLOW_UP.prompt}
                hint="Pick one cloud, then choose hosting for that cloud."
                options={CLOUD_FOLLOW_UP.options}
                selected={cloudChoice}
                disabled={disabled}
                onSelect={selectCloudFollowUp}
              />
              {cloudChoice && (
                <FollowUpPanel
                  prompt={`Which ${cloudChoice} hosting platform should we use?`}
                  hint="This replaces the originally suggested platform."
                  options={hostingOptions}
                  selected={hostingChoice}
                  disabled={disabled}
                  onSelect={selectHostingAfterCloud}
                />
              )}
            </>
          )}

          {isHostingChange && (
            <FollowUpPanel
              prompt="Which hosting platform do you want instead?"
              hint="These stay on your selected cloud. To use a different cloud, go back and pick 'Change the cloud'."
              options={hostingChangeOptions}
              selected={hostingChoice}
              disabled={disabled}
              onSelect={selectHostingFollowUp}
            />
          )}

          {isCiChange && (
            <FollowUpPanel
              prompt={CI_FOLLOW_UP.prompt}
              hint="Pick one option below, then continue."
              options={CI_FOLLOW_UP.options}
              selected={ciChoice}
              disabled={disabled}
              onSelect={selectCiFollowUp}
            />
          )}

          {isDataOther && (
            <>
              <FollowUpPanel
                prompt={DATA_FOLLOW_UP.prompt}
                hint="Pick one option below, then continue."
                options={DATA_FOLLOW_UP.options}
                selected={dataChoice}
                disabled={disabled}
                onSelect={selectDataFollowUp}
              />
              {needsOtherText && (
                <input
                  type="text"
                  value={followUpPrimary === 'Other' ? '' : followUpPrimary}
                  disabled={disabled}
                  onChange={(event) => {
                    if (!selectedOption) return;
                    onAnswer(
                      currentIndex,
                      `${selectedOption}: ${event.target.value}`
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      goNext();
                    }
                  }}
                  placeholder="Type the service name…"
                  aria-label="Custom data service"
                  className="mt-3 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[11px] text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              )}
            </>
          )}

          {!isCloudChange &&
            !isHostingChange &&
            !isCiChange &&
            !isDataOther && (
              <input
                type="text"
                value={selectedOption ? '' : currentAnswer}
                disabled={disabled}
                onChange={(event) => onAnswer(currentIndex, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    goNext();
                  }
                }}
                placeholder="Or type a different answer…"
                aria-label={`Custom answer for question ${currentIndex + 1}`}
                className="mt-3 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[11px] text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            )}
        </div>
      )}

      <div className="flex gap-2">
        {currentIndex > 0 && !isAdvancing && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={goNext}
          disabled={!canContinue}
          className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {continueHint
            ? continueHint
            : isLast
              ? 'Continue to architecture plan'
              : 'Next question'}
        </button>
      </div>
    </section>
  );
}
