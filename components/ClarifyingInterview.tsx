'use client';

import { useMemo, useState } from 'react';
import {
  HOSTING_OPTIONS_BY_CLOUD,
  CI_OPTION_LABELS_BY_CLOUD,
  adaptClarifyingQuestions,
  baseCloudFromSetupQuestion,
  cloudFromInterviewAnswer,
  interviewAlreadyChoseCi,
  isCiSystemQuestion,
  parseClarifyingQuestion,
} from '@/lib/clarifying-questions';
import { validateInterviewAnswer } from '@/lib/interview-answer-validation';

export { parseClarifyingQuestion };

interface ClarifyingInterviewProps {
  questions: string[];
  answers: Record<number, string>;
  disabled?: boolean;
  /** Shown when parent submit validation fails (was silent before). */
  submitError?: string | null;
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

const CI_FOLLOW_UP_DEFAULT: FollowUp = {
  prompt: 'Which CI/CD system do you want instead?',
  options: [
    'GitHub Actions',
    'AWS CodePipeline',
    'GitLab CI',
    'Google Cloud Build',
    'Jenkins',
    'Azure DevOps Pipelines',
    'OCI DevOps',
  ],
};

const ALL_HOSTING_OPTIONS = [
  'Amazon EKS',
  'Amazon ECS (Fargate)',
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
  cloud: string;
} {
  const parts = detail.split(/\s*\|\s*/).map((part) => part.trim());
  const hostingPart = parts.find((part) => /^Hosting:\s*/i.test(part));
  const cloudPart = parts.find((part) => /^Cloud:\s*/i.test(part));
  const primaryParts = parts.filter(
    (part) => !/^Hosting:\s*/i.test(part) && !/^Cloud:\s*/i.test(part)
  );
  return {
    primary: primaryParts.join(' | ').trim(),
    hosting: hostingPart ? hostingPart.replace(/^Hosting:\s*/i, '').trim() : '',
    cloud: cloudPart ? cloudPart.replace(/^Cloud:\s*/i, '').trim() : '',
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
  submitError = null,
  onAnswer,
  onSubmit,
}: ClarifyingInterviewProps) {
  const [step, setStep] = useState(0);
  const [isAdvancing, setIsAdvancing] = useState(false);

  const adaptedQuestions = useMemo(
    () => adaptClarifyingQuestions(questions, answers),
    [questions, answers]
  );

  // Skip the standalone CI question when the client already picked CI via
  // "Change CI/CD: …" on the setup question (avoids asking twice).
  const steps = useMemo(() => {
    const skipCi = interviewAlreadyChoseCi(answers);
    return adaptedQuestions
      .map((question, sourceIndex) => ({ question, sourceIndex }))
      .filter(({ question }) => !(skipCi && isCiSystemQuestion(question)));
  }, [adaptedQuestions, answers]);

  if (!steps.length) return null;

  const stepIndex = Math.min(step, steps.length - 1);
  const currentIndex = steps[stepIndex].sourceIndex;
  const { prompt, options } = parseClarifyingQuestion(steps[stepIndex].question);
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
  const baseCloud = baseCloudFromSetupQuestion(adaptedQuestions[0]);
  const hostingChangeOptions = baseCloud
    ? HOSTING_OPTIONS_BY_CLOUD[baseCloud]
    : ALL_HOSTING_OPTIONS;
  const ciFollowUp: FollowUp = {
    prompt: CI_FOLLOW_UP_DEFAULT.prompt,
    options: baseCloud
      ? CI_OPTION_LABELS_BY_CLOUD[baseCloud]
      : CI_FOLLOW_UP_DEFAULT.options,
  };

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
    ? ciFollowUp.options.find((option) => option === followUpPrimary) || null
    : null;

  const hostingOptions = isCloudChange
    ? hostingOptionsForCloud(cloudChoice)
    : ALL_HOSTING_OPTIONS;

  // "Another service" → free-text only (no Redis/MongoDB sub-question — those are already on the main list)
  const customDataService =
    isDataOther && detail.trim() && detail !== 'Other' ? detail.trim() : '';

  const answerValidation = validateInterviewAnswer(
    steps[stepIndex].question,
    currentAnswer,
    options
  );

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
      return Boolean(customDataService) && answerValidation.ok;
    }
    if (!answerValidation.ok) return false;
    return Boolean(selectedOption) || Boolean(currentAnswer.trim());
  })();

  const canContinue = answerComplete && !disabled && !isAdvancing;
  const isLast = stepIndex >= steps.length - 1;

  const answeredCount = steps.reduce((count, { question, sourceIndex }) => {
    const answer = answers[sourceIndex]?.trim() || '';
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
    const regionIndex = adaptedQuestions.findIndex((question) =>
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
    // Native CI on "Which CI/CD…" retargets region/hosting lists via adaptClarifyingQuestions
    if (
      isCiSystemQuestion(steps[stepIndex].question) &&
      (option === 'OCI DevOps' ||
        option === 'Google Cloud Build' ||
        option === 'AWS CodePipeline')
    ) {
      clearStaleRegionIfNeeded(option);
    }
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
    // Native CI implies its cloud — never leave silent AWS/EKS when user picks OCI DevOps etc.
    if (option === 'OCI DevOps') {
      onAnswer(
        currentIndex,
        `${selectedOption}: ${option} | Cloud: Oracle Cloud Infrastructure | Hosting: Oracle Kubernetes Engine (OKE)`
      );
      return;
    }
    if (option === 'Google Cloud Build') {
      onAnswer(
        currentIndex,
        `${selectedOption}: ${option} | Cloud: Google Cloud | Hosting: Google Kubernetes Engine (GKE)`
      );
      return;
    }
    if (option === 'AWS CodePipeline') {
      onAnswer(
        currentIndex,
        `${selectedOption}: ${option} | Cloud: AWS | Hosting: Amazon EKS`
      );
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
      setStep((value) => Math.min(value + 1, steps.length - 1));
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
    if (isDataOther && !customDataService) return 'Type the service name first';
    if (!answerValidation.ok) return answerValidation.error;
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
            Question {stepIndex + 1} of {steps.length}
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            Choose one option. If you pick a change, we ask short follow-ups so the
            plan matches what you need.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
          {answeredCount}/{steps.length}
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all duration-300"
          style={{
            width: `${((stepIndex + (answerComplete ? 1 : 0)) / steps.length) * 100}%`,
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
              prompt={ciFollowUp.prompt}
              hint="Includes GitHub/GitLab/Jenkins/Azure DevOps plus AWS CodePipeline, Google Cloud Build, and OCI DevOps."
              options={ciFollowUp.options}
              selected={ciChoice}
              disabled={disabled}
              onSelect={selectCiFollowUp}
            />
          )}

          {isDataOther && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] font-medium text-gray-700">
                Which data service do you need?
              </p>
              <p className="text-[10px] leading-relaxed text-gray-500">
                Type the service name (for example MongoDB, DynamoDB, or a message
                queue). Redis and SQL options are already listed above.
              </p>
              <input
                type="text"
                value={customDataService}
                disabled={disabled}
                autoFocus
                onChange={(event) => {
                  if (!selectedOption) return;
                  const value = event.target.value.trimStart();
                  onAnswer(
                    currentIndex,
                    value
                      ? `${selectedOption}: ${value}`
                      : selectedOption
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
                spellCheck={false}
                autoComplete="off"
                className="w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[11px] text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              {Boolean(customDataService) && !answerValidation.ok && (
                <p className="text-[10px] font-medium text-red-600" role="alert">
                  {answerValidation.error}
                </p>
              )}
            </div>
          )}

          {!isCloudChange &&
            !isHostingChange &&
            !isCiChange &&
            !isDataOther && (
              <input
                type="text"
                value={selectedOption ? '' : currentAnswer}
                disabled={disabled}
                spellCheck={false}
                autoComplete="off"
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
          {!isCloudChange &&
            !isHostingChange &&
            !isCiChange &&
            !isDataOther &&
            Boolean(currentAnswer.trim()) &&
            !selectedOption &&
            !answerValidation.ok && (
              <p className="mt-2 text-[10px] font-medium text-red-600" role="alert">
                {answerValidation.error}
              </p>
            )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {submitError ? (
          <p className="text-[11px] font-medium text-red-600" role="alert">
            {submitError}
          </p>
        ) : null}
        <div className="flex gap-2">
        {stepIndex > 0 && !isAdvancing && (
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
          title={continueHint || undefined}
          className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isLast ? 'Continue to architecture plan' : 'Next question'}
        </button>
        </div>
      </div>
    </section>
  );
}
