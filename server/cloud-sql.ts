import mysql from "mysql2/promise";

/**
 * Production Cloud SQL connection factory. The Cloud SQL Node.js Connector is preferred;
 * DATABASE_URL remains supported for local development and CI.
 */
export async function createCloudSqlPool() {
  const instance = process.env.CLOUD_SQL_INSTANCE;
  const database = process.env.CLOUD_SQL_DATABASE;
  const user = process.env.CLOUD_SQL_USER;
  const password = process.env.CLOUD_SQL_PASSWORD;
  if (!instance || !database || !user) return null;
  const { Connector, IpAddressTypes } = await import("@google-cloud/cloud-sql-connector");
  const connector = new Connector();
  const clientOpts = await connector.getOptions({ instanceConnectionName: instance, ipType: process.env.CLOUD_SQL_PRIVATE_IP === "true" ? IpAddressTypes.PRIVATE : IpAddressTypes.PUBLIC });
  return { pool: mysql.createPool({ ...clientOpts, user, password, database, waitForConnections: true, connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10), enableKeepAlive: true }), close: () => connector.close() };
}
