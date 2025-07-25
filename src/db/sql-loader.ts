// src/db/sql-loader.ts

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Loads an SQL file from the given directory and filename.
 */
export async function getSql(dirpath: string, filename: string): Promise<string> {
  const sqlFilePath = path.join(__dirname, dirpath, `${filename}.sql`);
  return fs.readFile(sqlFilePath, 'utf8');
}
