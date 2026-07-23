/**
 * Validate free-text interview answers so gibberish like "efewwe" / "wewer"
 * (and longer keyboard mash) cannot slip into the plan as fake requirements.
 */

const KNOWN_RUNTIMES: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'Node.js',
    pattern:
      /^(node\.?js|nodejs|node|express|nestjs|next\.?js|javascript|typescript|js|ts)$/i,
  },
  { label: 'Go', pattern: /^(go|golang|gin)$/i },
  { label: 'Python', pattern: /^(python|fastapi|django|flask|py)$/i },
  { label: 'Java', pattern: /^(java|spring(?:\s*boot)?)$/i },
  { label: '.NET', pattern: /^(\.net|dotnet|c#|csharp|asp\.?net)$/i },
];

const KNOWN_DATA_SERVICES: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'PostgreSQL',
    pattern: /^(postgres(?:ql)?|rds\s*postgres|aurora\s*postgres)$/i,
  },
  { label: 'MySQL', pattern: /^(mysql|aurora\s*mysql|mariadb)$/i },
  { label: 'Redis', pattern: /^(redis(?:\s*cache)?|elasticache\s*redis)$/i },
  { label: 'MongoDB', pattern: /^(mongo(?:db)?|documentdb)$/i },
  { label: 'DynamoDB', pattern: /^(dynamo(?:db)?|amazon\s*dynamodb)$/i },
  { label: 'Cassandra', pattern: /^(cassandra|scylla(?:db)?)$/i },
  { label: 'Elasticsearch', pattern: /^(elastic(?:search)?|opensearch)$/i },
  { label: 'Kafka', pattern: /^(kafka|msk|amazon\s*msk)$/i },
  { label: 'RabbitMQ', pattern: /^(rabbit(?:mq)?|amqp)$/i },
  { label: 'SQS', pattern: /^(sqs|amazon\s*sqs)$/i },
  { label: 'Cosmos DB', pattern: /^(cosmos(?:\s*db)?)$/i },
  { label: 'Firestore', pattern: /^(firestore|firebase)$/i },
  { label: 'Bigtable', pattern: /^(bigtable|cloud\s*bigtable)$/i },
  { label: 'Memcached', pattern: /^(memcached|elasticache\s*memcached)$/i },
  { label: 'SQL Server', pattern: /^(sql\s*server|mssql|azure\s*sql)$/i },
  { label: 'Oracle DB', pattern: /^(oracle(?:\s*db)?|autonomous\s*database)$/i },
];

const REGION_PATTERN =
  /^(us|eu|ap|sa|ca|me|af|cn|il|uk)-(central|east|west|north|south|northeast|southeast|northwest|southwest|mumbai|ashburn|frankfurt|london|jeddah|singapore|tokyo|sydney|ireland|paris|stockholm|seoul|osaka|hyderabad|melbourne|spain|zurich|calgary|uae|telaviv)-\d+[a-z]?$/i;

/** Any region we offer in the interview UI (all clouds). */
function isKnownInterviewRegion(value: string): boolean {
  const v = value.trim().toLowerCase();
  return Object.values(
    // lazy import avoided — list is duplicated via pattern + common IDs
    {
      aws: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'],
      gcp: ['us-central1', 'europe-west1', 'asia-south1'],
      azure: ['eastus', 'westeurope', 'centralindia'],
      oracle: ['ap-mumbai-1', 'us-ashburn-1', 'eu-frankfurt-1', 'uk-london-1', 'me-jeddah-1'],
    }
  )
    .flat()
    .some((region) => region.toLowerCase() === v);
}

const PRODUCT_HINT =
  /(sql|db|cache|mq|queue|store|base|search|stream|broker|bus|redis|mongo|kafka|postgres|mysql|elastic|dynamo|cosmos|fire|oracle|node|python|java|golang|\.net|eks|ecs|gke|aks|oke|devops|pipeline|actions|gitlab|jenkins)/i;

export function isLanguageQuestion(question: string): boolean {
  return /which language should the health-check service use/i.test(question);
}

export function isDataServiceQuestion(question: string): boolean {
  return /need stored data or a cache|how should .+ be configured/i.test(
    question
  );
}

export function isRegionQuestion(question: string): boolean {
  return /^Where should we host it\?/i.test(question.trim());
}

export function isStrictOptionQuestion(question: string): boolean {
  return (
    /does this setup match what you need/i.test(question) ||
    /which (ci\/cd system|environments) do you need|which ci\/cd system should we use/i.test(
      question
    ) ||
    /who should be able to access the api/i.test(question) ||
    /how much traffic should we plan for/i.test(question)
  );
}

/** Keyboard mash / nonsense — length-independent. */
export function looksLikeGibberish(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[^a-z0-9\s.+#-]/g, '');
  const letters = t.replace(/[^a-z]/g, '');
  if (!letters) return true;
  if (letters.length < 2) return true;
  if (/^(.)\1{3,}$/.test(letters)) return true;

  // Repeated blocks: sdfsdf, asdasd, wdwefwdwef
  if (letters.length >= 6 && /(.{2,5})\1{1,}/i.test(letters)) return true;

  const vowels = (letters.match(/[aeiouy]/g) || []).length;
  const vowelRatio = vowels / letters.length;
  const unique = new Set(letters.split('')).size;
  const uniqueRatio = unique / letters.length;

  // Low vowel density on any length ≥5
  if (letters.length >= 5 && vowelRatio < 0.2) return true;

  // Long single-token mash (the bug: old code only blocked ≤12 chars)
  if (!/\s/.test(t) && letters.length >= 8) {
    if (uniqueRatio <= 0.45) return true;
    if (vowelRatio <= 0.4 && !PRODUCT_HINT.test(t)) return true;
    // Mostly consonant clusters with few unique letters (sdsafsdfsdfsdfsdf)
    if (unique <= 6 && vowelRatio <= 0.45) return true;
  }

  // Medium mash without product shape
  if (
    letters.length >= 5 &&
    !/\s/.test(t) &&
    vowelRatio <= 0.4 &&
    !PRODUCT_HINT.test(t)
  ) {
    if (uniqueRatio <= 0.55) return true;
    if (/(.)\1/.test(letters) && unique <= Math.max(4, letters.length * 0.5)) {
      return true;
    }
  }

  // Common smash patterns (any length / repeated)
  if (
    /^(asdf|qwer|zxcv|test|xxx|aaa|bbb|abc|abcd|foo|bar|baz|n\/a|na|idk|asdfgh|qwerty|sdf|asd|wef|dfs)+$/i.test(
      letters
    )
  ) {
    return true;
  }

  // Short nonsense with repeated letters (efewwe)
  if (
    letters.length >= 4 &&
    letters.length <= 8 &&
    !/\s/.test(t) &&
    /(.)\1/.test(letters) &&
    unique <= 3
  ) {
    return true;
  }

  return false;
}

function matchKnown(
  value: string,
  catalog: Array<{ label: string; pattern: RegExp }>
): string | null {
  const cleaned = value.trim().replace(/^another service:\s*/i, '');
  for (const entry of catalog) {
    if (entry.pattern.test(cleaned)) return entry.label;
  }
  return null;
}

export function normalizeRuntimeAnswer(value: string): string | null {
  return matchKnown(value, KNOWN_RUNTIMES);
}

export function normalizeDataServiceAnswer(value: string): string | null {
  const cleaned = value.trim().replace(/^another service:\s*/i, '');
  if (/^no data service$/i.test(cleaned)) return 'No data service';
  return matchKnown(cleaned, KNOWN_DATA_SERVICES);
}

export type InterviewValidationResult =
  | { ok: true; normalized?: string }
  | { ok: false; error: string };

const GIBBERISH_ERROR =
  'That does not look like a valid option — pick from the list or type a clear answer';

/**
 * Validate a free-text / custom interview answer in context of the question.
 * Option-card picks that exactly match listed options are always OK.
 */
export function validateInterviewAnswer(
  question: string,
  rawAnswer: string,
  listedOptions: string[] = []
): InterviewValidationResult {
  const answer = rawAnswer.trim();
  if (!answer) return { ok: false, error: 'Enter an answer first' };

  // Exact option match (including "Another service" before detail is filled)
  if (listedOptions.some((opt) => opt === answer)) {
    if (answer === 'Another service') {
      return { ok: false, error: 'Type the service name first' };
    }
    return { ok: true, normalized: answer };
  }

  // Partial match of a long option label (user typed a clear subset)
  const softMatch = listedOptions.find(
    (opt) =>
      opt.toLowerCase() === answer.toLowerCase() ||
      (answer.length >= 8 &&
        opt.toLowerCase().includes(answer.toLowerCase()) &&
        !looksLikeGibberish(answer))
  );
  if (softMatch) return { ok: true, normalized: softMatch };

  // Structured "Another service: X"
  if (/^another service:\s*/i.test(answer)) {
    const detail = answer.replace(/^another service:\s*/i, '').trim();
    if (!detail || detail === 'Other') {
      return { ok: false, error: 'Type the service name first' };
    }
    const known = normalizeDataServiceAnswer(detail);
    if (known) return { ok: true, normalized: `Another service: ${known}` };
    if (looksLikeGibberish(detail) || detail.length < 3) {
      return {
        ok: false,
        error:
          'Enter a real data service (e.g. MongoDB, DynamoDB, Kafka) — random text is not accepted',
      };
    }
    const isMultiWord = /\s/.test(detail.trim());
    const hasProductHint = PRODUCT_HINT.test(detail);
    if (!isMultiWord && !hasProductHint) {
      return {
        ok: false,
        error:
          'Use a known service name (MongoDB, DynamoDB, Kafka, …) or type a clear product name — not random text',
      };
    }
    if (!/[a-z]/i.test(detail) || !/[aeiouy]/i.test(detail)) {
      return {
        ok: false,
        error: 'Enter a recognizable data service name',
      };
    }
    return { ok: true, normalized: `Another service: ${detail}` };
  }

  if (isLanguageQuestion(question)) {
    const known = normalizeRuntimeAnswer(answer);
    if (known) return { ok: true, normalized: known };
    return {
      ok: false,
      error:
        'Pick Node.js, Go, Python, Java, or .NET — unsupported languages are not accepted',
    };
  }

  if (isDataServiceQuestion(question)) {
    const known = normalizeDataServiceAnswer(answer);
    if (known) return { ok: true, normalized: known };
    if (looksLikeGibberish(answer) || answer.length < 3) {
      return {
        ok: false,
        error:
          'Enter a real data service (PostgreSQL, MySQL, Redis, MongoDB, …) — random text is not accepted',
      };
    }
  }

  if (isRegionQuestion(question)) {
    const compact = answer.replace(/\s+/g, '');
    if (
      REGION_PATTERN.test(compact) ||
      isKnownInterviewRegion(compact) ||
      listedOptions.some((opt) => opt.toLowerCase() === answer.toLowerCase())
    ) {
      return { ok: true, normalized: compact };
    }
    if (looksLikeGibberish(answer)) {
      return { ok: false, error: GIBBERISH_ERROR };
    }
    // Allow clear region-like custom answers (e.g. "Mumbai", "Frankfurt")
    if (answer.length < 3 || !/[a-z]/i.test(answer) || !/[aeiouy]/i.test(answer)) {
      return { ok: false, error: GIBBERISH_ERROR };
    }
  }

  // Setup / CI / env / access / traffic: prefer list; always block mash
  if (isStrictOptionQuestion(question) || listedOptions.length > 0) {
    if (looksLikeGibberish(answer)) {
      return { ok: false, error: GIBBERISH_ERROR };
    }
    // Allow known cloud regions even when the listed options are stale (AWS list
    // after the UI adapted to Oracle — QA #6 Continue stuck).
    if (isKnownInterviewRegion(answer.replace(/\s+/g, '')) || REGION_PATTERN.test(answer.replace(/\s+/g, ''))) {
      return { ok: true, normalized: answer.replace(/\s+/g, '') };
    }
    // Single opaque token on a multiple-choice question → force list
    if (
      listedOptions.length > 0 &&
      !/\s/.test(answer) &&
      answer.length >= 6 &&
      !PRODUCT_HINT.test(answer) &&
      !REGION_PATTERN.test(answer) &&
      !isKnownInterviewRegion(answer)
    ) {
      return {
        ok: false,
        error: 'Pick an option from the list — random text is not accepted',
      };
    }
  }

  // Generic custom answers: block mash at any length (was capped at ≤12)
  if (
    !listedOptions.some((opt) => answer.startsWith(`${opt}:`)) &&
    looksLikeGibberish(answer)
  ) {
    return { ok: false, error: GIBBERISH_ERROR };
  }

  return { ok: true };
}
