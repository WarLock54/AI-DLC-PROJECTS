// NFR12: nothing that identifies an account or grants access may reach an evidence
// file. Every renderer passes its output through redact() before it is written.

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/"cancelToken"\s*:\s*"[^"]*"/g, '"cancelToken":"[redacted-token]"'],
  [
    /\b(AWS_SESSION_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID)\s*[=:]\s*\S+/g,
    "$1=[redacted-credential]",
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted-token]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[redacted-jwt]"],
  [/\b(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}\b/g, "[redacted-access-key-id]"],
  [/arn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:\d{0,12}:[^\s"'`),;]+/g, "[redacted-arn]"],
  [/\b\d{12}\b/g, "[redacted-account-id]"],
  [/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g, "[redacted]@$1"],
];

/** Removes credentials, tokens, ARNs, account IDs, and email local parts from text. */
export function redact(text: string): string {
  return RULES.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}
