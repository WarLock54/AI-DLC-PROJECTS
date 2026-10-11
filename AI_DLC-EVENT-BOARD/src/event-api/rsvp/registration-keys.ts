// C-03 v1 Registration keys (D5). Every status uses the same v1 key shape the
// C1 seed ships: gsi5sk = WAITLIST#{waitlistedAt}#REG#{registrationId}, with an
// empty waitlistedAt for confirmed registrations.
export type RegistrationStatus = "confirmed" | "waitlisted" | "cancelled";

export interface RegistrationPrimaryKey {
  pk: string;
  sk: string;
}

export interface RegistrationStatusKeys {
  gsi5pk: string;
  gsi5sk: string;
}

export interface CancelTokenKeys {
  gsi6pk: string;
  gsi6sk: string;
}

export function registrationPrimaryKey(
  eventId: string,
  normalizedEmail: string,
): RegistrationPrimaryKey {
  return { pk: `EVENT#${eventId}`, sk: `REG#${normalizedEmail}` };
}

export function registrationStatusPartition(eventId: string, status: RegistrationStatus): string {
  return `REGISTRATION#EVENT#${eventId}#STATUS#${status}`;
}

/**
 * Status keys for a registration. Only waitlisted registrations order by
 * waitlistedAt; confirmed registrations keep the empty-timestamp seed shape.
 */
export function registrationStatusKeys(
  eventId: string,
  registrationId: string,
  status: RegistrationStatus,
  waitlistedAt = "",
): RegistrationStatusKeys {
  const orderedAt = status === "confirmed" ? "" : waitlistedAt;
  return {
    gsi5pk: registrationStatusPartition(eventId, status),
    gsi5sk: `WAITLIST#${orderedAt}#REG#${registrationId}`,
  };
}

export function cancelTokenPartition(tokenDigest: string): string {
  return `CANCEL#${tokenDigest}`;
}

export function cancelTokenKeys(
  tokenDigest: string,
  eventId: string,
  registrationId: string,
): CancelTokenKeys {
  return {
    gsi6pk: cancelTokenPartition(tokenDigest),
    gsi6sk: `EVENT#${eventId}#REG#${registrationId}`,
  };
}
