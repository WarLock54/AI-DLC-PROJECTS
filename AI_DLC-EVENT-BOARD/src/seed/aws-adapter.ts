import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  type CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  type SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { DemoUserAdapter } from "./demo-users.js";
import { isValidDemoPassword } from "./demo-users.js";

export class AwsSeedAdapter implements DemoUserAdapter {
  constructor(
    private readonly secrets: SecretsManagerClient,
    private readonly cognito: CognitoIdentityProviderClient,
    private readonly secretArn: string,
    private readonly userPoolId: string,
  ) {}

  async readCredentials(): Promise<string | undefined> {
    const response = await this.secrets.send(
      new GetSecretValueCommand({ SecretId: this.secretArn }),
    );
    return response.SecretString;
  }

  async writeCredentials(value: string): Promise<void> {
    await this.secrets.send(
      new PutSecretValueCommand({ SecretId: this.secretArn, SecretString: value }),
    );
  }

  async ensureUser({
    username,
    password,
    group,
  }: {
    username: string;
    password: string;
    group: string;
  }): Promise<string | undefined> {
    if (!isValidDemoPassword(password)) {
      throw new Error("Demo password does not satisfy the Cognito password policy.");
    }
    try {
      await this.cognito.send(
        new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }),
      );
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "UserNotFoundException") {
        throw error;
      }
      await this.cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          MessageAction: "SUPPRESS",
          UserAttributes: [
            { Name: "email", Value: username },
            { Name: "email_verified", Value: "true" },
          ],
        }),
      );
    }

    await this.cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        Password: password,
        Permanent: true,
      }),
    );
    await this.cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        GroupName: group,
      }),
    );

    if (group !== "organizer") {
      return undefined;
    }
    const user = await this.cognito.send(
      new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }),
    );
    const subject = user.UserAttributes?.find(({ Name }) => Name === "sub")?.Value;
    if (!subject) {
      throw new Error("Cognito organizer lookup did not return a subject.");
    }
    return subject;
  }
}
