import {
  CloudFormationClient,
  DeleteStackCommand,
  ListStacksCommand,
  StackStatus,
  waitUntilStackDeleteComplete,
} from "@aws-sdk/client-cloudformation";
import { CloudWatchLogsClient, DeleteLogGroupCommand } from "@aws-sdk/client-cloudwatch-logs";
import {
  CognitoIdentityProviderClient,
  DeleteUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableNotExists,
} from "@aws-sdk/client-dynamodb";
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from "@aws-sdk/client-resource-groups-tagging-api";
import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DeleteSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { fromEnv } from "@aws-sdk/credential-providers";
import {
  PROJECT_TAG_KEY,
  PROJECT_TAG_VALUE,
  type DeletionOutcome,
  type ObjectVersion,
  type ObjectVersionPage,
  type TeardownPorts,
  type VersionPageMarker,
} from "./teardown.js";

export interface TeardownClients {
  cloudFormation: CloudFormationClient;
  tagging: ResourceGroupsTaggingAPIClient;
  s3: S3Client;
  logs: CloudWatchLogsClient;
  cognito: CognitoIdentityProviderClient;
  dynamodb: DynamoDBClient;
  secrets: SecretsManagerClient;
}

export interface WaiterLimits {
  stackDeleteSeconds: number;
  tableDeleteSeconds: number;
}

const DEFAULT_WAITER_LIMITS: WaiterLimits = {
  // CloudFront distributions can take well over ten minutes to delete.
  stackDeleteSeconds: 3600,
  tableDeleteSeconds: 600,
};

const LIVE_STACK_STATUSES = Object.values(StackStatus).filter(
  (status) => status !== StackStatus.DELETE_COMPLETE,
);

/** Builds SDK clients that use environment credentials only (no profiles). */
export function createTeardownClients(region: string): TeardownClients {
  const config = { region, credentials: fromEnv() };
  return {
    cloudFormation: new CloudFormationClient(config),
    tagging: new ResourceGroupsTaggingAPIClient(config),
    s3: new S3Client(config),
    logs: new CloudWatchLogsClient(config),
    cognito: new CognitoIdentityProviderClient(config),
    dynamodb: new DynamoDBClient(config),
    secrets: new SecretsManagerClient(config),
  };
}

function isNotFound(error: unknown, names: readonly string[]): boolean {
  return error instanceof Error && names.includes(error.name);
}

/** Runs a delete call; a "not found" error means it is already gone (idempotent rerun). */
async function deleteIfPresent(
  operation: () => Promise<unknown>,
  notFoundNames: readonly string[],
): Promise<DeletionOutcome> {
  try {
    await operation();
    return "deleted";
  } catch (error: unknown) {
    if (isNotFound(error, notFoundNames)) {
      return "absent";
    }
    throw error;
  }
}

const RESOURCE_NOT_FOUND = ["ResourceNotFoundException"] as const;

export function createAwsPorts(
  clients: TeardownClients,
  limits: WaiterLimits = DEFAULT_WAITER_LIMITS,
): TeardownPorts {
  return {
    async listStackNames() {
      const names: string[] = [];
      let nextToken: string | undefined;
      do {
        const page = await clients.cloudFormation.send(
          new ListStacksCommand({ StackStatusFilter: LIVE_STACK_STATUSES, NextToken: nextToken }),
        );
        for (const summary of page.StackSummaries ?? []) {
          if (summary.StackName) {
            names.push(summary.StackName);
          }
        }
        nextToken = page.NextToken;
      } while (nextToken);
      return names;
    },

    async deleteStack(name) {
      await clients.cloudFormation.send(new DeleteStackCommand({ StackName: name }));
    },

    async waitForStackDeleted(name) {
      await waitUntilStackDeleteComplete(
        { client: clients.cloudFormation, maxWaitTime: limits.stackDeleteSeconds },
        { StackName: name },
      );
    },

    async listTaggedResourceArns() {
      const arns: string[] = [];
      let paginationToken: string | undefined;
      do {
        const page = await clients.tagging.send(
          new GetResourcesCommand({
            TagFilters: [{ Key: PROJECT_TAG_KEY, Values: [PROJECT_TAG_VALUE] }],
            PaginationToken: paginationToken,
          }),
        );
        for (const mapping of page.ResourceTagMappingList ?? []) {
          if (mapping.ResourceARN) {
            arns.push(mapping.ResourceARN);
          }
        }
        paginationToken = page.PaginationToken || undefined;
      } while (paginationToken);
      return arns;
    },

    async listObjectVersions(bucket, marker?: VersionPageMarker) {
      try {
        const page = await clients.s3.send(
          new ListObjectVersionsCommand({
            Bucket: bucket,
            KeyMarker: marker?.keyMarker,
            VersionIdMarker: marker?.versionIdMarker,
          }),
        );
        const versions: ObjectVersion[] = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
          .filter((entry) => entry.Key !== undefined)
          .map((entry) => ({ key: entry.Key as string, versionId: entry.VersionId ?? "null" }));
        const result: ObjectVersionPage = { versions };
        if (page.IsTruncated && page.NextKeyMarker) {
          result.next = {
            keyMarker: page.NextKeyMarker,
            versionIdMarker: page.NextVersionIdMarker,
          };
        }
        return result;
      } catch (error: unknown) {
        if (isNotFound(error, ["NoSuchBucket"])) {
          return "absent";
        }
        throw error;
      }
    },

    async deleteObjectVersions(bucket, versions) {
      const response = await clients.s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: versions.map((version) => ({
              Key: version.key,
              VersionId: version.versionId,
            })),
            Quiet: true,
          },
        }),
      );
      const errors = response.Errors ?? [];
      if (errors.length > 0) {
        const codes = [...new Set(errors.map((entry) => entry.Code ?? "Unknown"))].join(", ");
        throw new Error(`${errors.length} object version(s) could not be deleted (${codes}).`);
      }
    },

    deleteBucket: (bucket) =>
      deleteIfPresent(
        () => clients.s3.send(new DeleteBucketCommand({ Bucket: bucket })),
        ["NoSuchBucket"],
      ),

    deleteLogGroup: (name) =>
      deleteIfPresent(
        () => clients.logs.send(new DeleteLogGroupCommand({ logGroupName: name })),
        RESOURCE_NOT_FOUND,
      ),

    deleteUserPool: (userPoolId) =>
      deleteIfPresent(
        () => clients.cognito.send(new DeleteUserPoolCommand({ UserPoolId: userPoolId })),
        RESOURCE_NOT_FOUND,
      ),

    deleteTable: (name) =>
      deleteIfPresent(async () => {
        await clients.dynamodb.send(new DeleteTableCommand({ TableName: name }));
        await waitUntilTableNotExists(
          { client: clients.dynamodb, maxWaitTime: limits.tableDeleteSeconds },
          { TableName: name },
        );
      }, RESOURCE_NOT_FOUND),

    deleteSecret: (secretArn) =>
      deleteIfPresent(
        () =>
          clients.secrets.send(
            new DeleteSecretCommand({ SecretId: secretArn, ForceDeleteWithoutRecovery: true }),
          ),
        RESOURCE_NOT_FOUND,
      ),
  };
}
