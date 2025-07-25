// src/config/env_config.ts

import dotenv from 'dotenv';
dotenv.config();

export const token = process.env.DISCORD_BOT_TOKEN ?? '';
export const runMode = process.env.RUN_MODE ?? 'development';

export const pgHost = process.env.PG_HOST ?? '';
export const pgPort = process.env.PG_PORT ?? '';
export const pgUser = process.env.PG_USER ?? '';
export const pgPass = process.env.PG_PASS ?? '';
export const pgDb = process.env.PG_DB ?? '';
