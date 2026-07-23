/**
 * Validate free-text interview answers so gibberish like "efewwe" / "wewer"
 * cannot slip into the plan as fake requirements (then silently become Node/Postgres).
 */

const KNOWN_RUNTIMES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Node.js', pattern: /^(node\.?js|nodejs|node|express|nestjs|next\.?js|javascript|typescript|js|ts)$/i },
  { label: 'Go', pattern: /^(go|golang|gin)$/i },
  { label: 'Python', pattern: /^(python|fastapi|django|flask|py)$/i },
  { label: 'Java', pattern: /^(java|spring(?:\s*boot)?)$/i },
  { label: '.NET', pattern: /^(\.net|dotnet|c#|csharp|asp\.?net)$/i },
];

const KNOWN_DATA_SERVICES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'PostgreSQL', pattern: /^(postgres(?:ql)?|rds\s*postgres|aurora\s*postgres)$/i },
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

export function isLanguageQuestion(question: string): boolean {
  return /which language should the health-check service use/i.test(question);
}

export function isDataServiceQuestion(question: string): boolean {
  return /need stored data or a cache|how should .+ be configured/i.test(question);
}

export function looksLikeGibberish(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[^a-z0-9\s.+#-]/g, '');
  const letters = t.replace(/[^a-z]/g, '');
  if (!letters) return true;
  if (letters.length < 2) return true;
  if (/^(.)\1{3,}$/.test(letters)) return true;
  // No vowels in a short token → keyboard mash (e.g. "wewer" has vowels; "efewwe" has e)
  const vowels = (letters.match(/[aeiouy]/g) || []).length;
  const vowelRatio = vowels / letters.length;
  if (letters.length >= 5 && vowelRatio < 0.2) return true;
  // Alternating nonsense without spaces and no known product shape
  if (
    letters.length >= 5 &&
    letters.length <= 10 &&
    !/\s/.test(t) &&
    vowelRatio <= 0.35 &&
    !/(sql|db|cache|mq|queue|store|base|search|stream)/i.test(t)
  ) {
    // "efewwe", "wewer", "asdfgh" style — reject unless it matches a known list later
    const unique = new Set(letters.split('')).size;
    if (unique <= letters.length * 0.55) return true;
  }
  // Common smash patterns
  if (/^(asdf|qwer|zxcv|test|xxx|aaa|bbb|abc|abcd|foo|bar|baz|n\/a|na|idk|asdfgh|qwerty)+$/i.test(letters)) {
    return true;
  }
  // Short nonsense tokens with repeated letters (efewwe, wewer-like mash)
  if (
    letters.length >= 4 &&
    letters.length <= 8 &&
    !/\s/.test(t) &&
    /(.)\1/.test(letters) &&
    new Set(letters.split('')).size <= 3
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
    // Unknown single-token mash (e.g. "efewwe") — require a known service or a clear product-like name
    const isMultiWord = /\s/.test(detail.trim());
    const hasProductHint =
      /(db|sql|cache|queue|mq|stream|store|search|base|broker|bus)/i.test(detail);
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
      error: 'Pick Node.js, Go, Python, Java, or .NET — unsupported languages are not accepted',
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

  // Generic custom answers on other questions: block obvious mash
  if (
    !listedOptions.some((opt) => answer.startsWith(`${opt}:`)) &&
    looksLikeGibberish(answer) &&
    answer.length <= 12
  ) {
    return {
      ok: false,
      error: 'That does not look like a valid option — pick from the list or type a clear answer',
    };
  }

  return { ok: true };
}
