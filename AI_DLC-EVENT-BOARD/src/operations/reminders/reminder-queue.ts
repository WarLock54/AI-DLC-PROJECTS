import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { serializeReminderMessage, type ReminderQueueMessageV1 } from "./message.js";

/** C-05 producer port; tests pass an in-memory fake. */
export interface ReminderQueue {
  /** Sends one C-05 message. Throws when SQS does not accept it. */
  send(message: ReminderQueueMessageV1): Promise<void>;
}

export class SqsReminderQueue implements ReminderQueue {
  constructor(
    private readonly client: Pick<SQSClient, "send">,
    private readonly queueUrl: string,
  ) {}

  async send(message: ReminderQueueMessageV1): Promise<void> {
    const result = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: serializeReminderMessage(message),
      }),
    );
    if (!result.MessageId) {
      throw new Error("SQS did not acknowledge the reminder message.");
    }
  }
}
