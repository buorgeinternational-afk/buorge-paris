import { readFile, writeFile } from "node:fs/promises";

const databaseId = "2291947b-ce52-43f3-bb11-9baf6bc4a9bd";
const input = new URL("../dist/server/wrangler.json", import.meta.url);
const output = new URL("../dist/server/wrangler-preview.json", import.meta.url);
const config = JSON.parse(await readFile(input, "utf8"));

config.name = "buorge-paris-preview";
config.topLevelName = config.name;
config.d1_databases = [{
  binding: "DB",
  database_name: "buorge-paris-store",
  database_id: databaseId,
}];
config.r2_buckets = [{ binding: "BUCKET", bucket_name: "buorge-paris-assets" }];
config.vars = { ...config.vars, APP_PREVIEW_READ_ONLY: "true" };

await writeFile(output, `${JSON.stringify(config, null, 2)}\n`);
console.log("Prepared read-only Cloudflare preview configuration.");
