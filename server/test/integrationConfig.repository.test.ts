"use strict";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { IntegrationConfigRepository } from "../src/repositories/integrationConfigRepository";

describe("IntegrationConfigRepository", () => {
  it("returns empty results when the integration_configs table is missing", async () => {
    const db = {
      query: async () => {
        const error = new Error(
          "Table 'kneachat.integration_configs' doesn't exist",
        ) as Error & { code?: string };
        error.code = "ER_NO_SUCH_TABLE";
        throw error;
      },
    } as any;

    const repo = new IntegrationConfigRepository(db);

    await assert.doesNotReject(async () => {
      assert.deepEqual(await repo.findByCompany(42), []);
      assert.equal(await repo.findByCompanyAndChannel(42, "email"), null);
      assert.deepEqual(await repo.findAll(), []);
    });
  });
});
