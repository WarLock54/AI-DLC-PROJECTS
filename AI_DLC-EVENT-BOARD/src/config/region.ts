// The deployment region is whatever AWS_DEFAULT_REGION carries in CI/CD; it is
// never hardcoded or limited to a fixed list. Only a missing or malformed value
// is rejected so a typo fails fast instead of reaching CDK.
const REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d+$/;

export type AllowedRegion = string;

export function resolveRegion(
  value: string | undefined = process.env.AWS_DEFAULT_REGION,
): AllowedRegion {
  if (!value) {
    throw new Error("AWS_DEFAULT_REGION is required; set it in the CI/CD variables.");
  }

  if (!REGION_PATTERN.test(value)) {
    throw new Error(
      `AWS_DEFAULT_REGION '${value}' is not a valid AWS region name (for example eu-west-1).`,
    );
  }

  return value;
}
