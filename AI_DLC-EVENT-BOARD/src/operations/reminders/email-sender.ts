import { SendEmailCommand, type SESv2Client } from "@aws-sdk/client-sesv2";

export type EmailMode = "log" | "ses";

export interface ReminderDelivery {
  eventId: string;
  registrationId: string;
  scheduledFor: string;
  startsAt: string;
  eventTitle: string;
  /** Used only by the SES adapter; never logged. */
  recipientEmail: string;
}

/** Reminder delivery port (FR7.2, FR7.6). Throws when delivery fails. */
export interface EmailSender {
  readonly mode: EmailMode;
  deliver(reminder: ReminderDelivery): Promise<void>;
}

/**
 * EMAIL_MODE=log (default, final sandbox): one CloudWatch JSON line per
 * reminder with identifiers and times only. No name, email, or token.
 */
export class LogEmailSender implements EmailSender {
  readonly mode = "log" as const;

  constructor(private readonly write: (line: string) => void = (line) => console.log(line)) {}

  async deliver(reminder: ReminderDelivery): Promise<void> {
    await Promise.resolve();
    this.write(
      JSON.stringify({
        type: "reminder",
        eventId: reminder.eventId,
        registrationId: reminder.registrationId,
        scheduledFor: reminder.scheduledFor,
        startsAt: reminder.startsAt,
        mode: "log",
      }),
    );
  }
}

/** EMAIL_MODE=ses (debug sandbox only, verified recipient). */
export class SesEmailSender implements EmailSender {
  readonly mode = "ses" as const;

  constructor(
    private readonly client: Pick<SESv2Client, "send">,
    private readonly fromAddress: string,
  ) {
    if (!fromAddress.includes("@")) {
      throw new Error("REMINDER_SENDER_EMAIL must be an email address.");
    }
  }

  async deliver(reminder: ReminderDelivery): Promise<void> {
    if (!reminder.recipientEmail.includes("@")) {
      throw new Error("The confirmed registration has no deliverable email address.");
    }
    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.fromAddress,
        Destination: { ToAddresses: [reminder.recipientEmail] },
        Content: {
          Simple: {
            Subject: { Data: `Reminder: ${reminder.eventTitle}` },
            Body: {
              Text: {
                Data:
                  `Your community event "${reminder.eventTitle}" starts at ` +
                  `${reminder.startsAt} (UTC). We look forward to seeing you.`,
              },
            },
          },
        },
      }),
    );
    if (!result.MessageId) {
      throw new Error("SES did not accept the reminder email.");
    }
  }
}
