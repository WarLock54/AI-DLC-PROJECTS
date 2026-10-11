/**
 * Test helper: evaluates the subset of GitLab CI `rules:if` syntax this
 * pipeline uses (`$VAR`, quoted strings, `==`, `!=`, `&&`, `||`, parentheses)
 * and computes which jobs a pipeline context would run. Anything outside that
 * subset throws, so the tests fail instead of guessing if the YAML grows.
 */
export type PipelineVariables = Readonly<Record<string, string | undefined>>;

export interface Rule {
  if?: string;
  when?: string;
}

export interface JobDefinition {
  stage?: string;
  extends?: string | string[];
  rules?: Rule[];
  script?: string[];
  needs?: Array<string | { job: string; artifacts?: boolean }>;
  when?: string;
  allow_failure?: boolean;
  image?: string | { name: string };
  [key: string]: unknown;
}

export interface PipelineDefinition {
  workflow?: { rules?: Rule[] };
  stages?: string[];
  default?: { image?: string | { name: string } };
  [key: string]: unknown;
}

type Token =
  | { kind: "variable"; name: string }
  | { kind: "string"; value: string }
  | { kind: "operator"; value: "==" | "!=" | "&&" | "||" | "(" | ")" };

const RESERVED_KEYS = new Set([
  "workflow",
  "stages",
  "variables",
  "default",
  "include",
  "image",
  "services",
  "cache",
  "before_script",
  "after_script",
]);

export function tokenize(expression: string): Token[] {
  const pattern = /\s*(?:\$([A-Za-z_][A-Za-z0-9_]*)|"([^"]*)"|'([^']*)'|(==|!=|&&|\|\||\(|\)))/y;
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    if (/^\s*$/.test(expression.slice(index))) {
      break;
    }
    pattern.lastIndex = index;
    const match = pattern.exec(expression);
    if (!match) {
      throw new Error(`Unsupported rules:if syntax at '${expression.slice(index)}'.`);
    }
    if (match[1] !== undefined) {
      tokens.push({ kind: "variable", name: match[1] });
    } else if (match[2] !== undefined || match[3] !== undefined) {
      tokens.push({ kind: "string", value: match[2] ?? match[3] });
    } else {
      tokens.push({ kind: "operator", value: match[4] as "==" });
    }
    index = pattern.lastIndex;
  }
  return tokens;
}

/** Recursive-descent evaluation: `||` binds looser than `&&`, which binds looser than comparisons. */
export function evaluateIf(expression: string, variables: PipelineVariables): boolean {
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  const operand = (): string | null => {
    const token = take();
    if (token?.kind === "variable") {
      const value = variables[token.name];
      return value === undefined || value === "" ? null : value;
    }
    if (token?.kind === "string") {
      return token.value;
    }
    throw new Error(`Expected a variable or string in '${expression}'.`);
  };

  const primary = (): boolean => {
    const token = peek();
    if (token?.kind === "operator" && token.value === "(") {
      take();
      const value = disjunction();
      const closing = take();
      if (closing?.kind !== "operator" || closing.value !== ")") {
        throw new Error(`Missing ')' in '${expression}'.`);
      }
      return value;
    }
    const left = operand();
    const next = peek();
    if (next?.kind === "operator" && (next.value === "==" || next.value === "!=")) {
      take();
      const right = operand();
      return next.value === "==" ? left === right : left !== right;
    }
    return left !== null;
  };

  const conjunction = (): boolean => {
    let value = primary();
    while (peek()?.kind === "operator" && (peek() as { value: string }).value === "&&") {
      take();
      const right = primary();
      value = value && right;
    }
    return value;
  };

  const disjunction = (): boolean => {
    let value = conjunction();
    while (peek()?.kind === "operator" && (peek() as { value: string }).value === "||") {
      take();
      const right = conjunction();
      value = value || right;
    }
    return value;
  };

  const result = disjunction();
  if (position !== tokens.length) {
    throw new Error(`Unexpected trailing tokens in '${expression}'.`);
  }
  return result;
}

/** GitLab semantics: the first matching rule decides; no match means the job is not added. */
export function rulesAllow(rules: Rule[] | undefined, variables: PipelineVariables): boolean {
  if (rules === undefined) {
    return true;
  }
  for (const rule of rules) {
    if (rule.if === undefined || evaluateIf(rule.if, variables)) {
      return rule.when !== "never";
    }
  }
  return false;
}

export function jobNames(pipeline: PipelineDefinition): string[] {
  return Object.keys(pipeline).filter((key) => !RESERVED_KEYS.has(key) && !key.startsWith("."));
}

/** Resolves `extends` with GitLab's merge order: templates first, the job's own keys win. */
export function resolveJob(pipeline: PipelineDefinition, name: string): JobDefinition {
  const job = pipeline[name] as JobDefinition | undefined;
  if (!job) {
    throw new Error(`Unknown job or template '${name}'.`);
  }
  const parents = job.extends === undefined ? [] : [job.extends].flat();
  const inherited = parents.reduce<JobDefinition>(
    (merged, parent) => ({ ...merged, ...resolveJob(pipeline, parent) }),
    {},
  );
  const own: JobDefinition = { ...job };
  delete own.extends;
  return { ...inherited, ...own };
}

/** Jobs GitLab would create for the context, or an empty list when the workflow blocks the pipeline. */
export function selectJobs(pipeline: PipelineDefinition, variables: PipelineVariables): string[] {
  if (!rulesAllow(pipeline.workflow?.rules, variables)) {
    return [];
  }
  return jobNames(pipeline).filter((name) =>
    rulesAllow(resolveJob(pipeline, name).rules, variables),
  );
}
