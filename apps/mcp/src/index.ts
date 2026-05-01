import { loadConfig, createServices } from '@pantrymind/core';
import { createDb } from '@pantrymind/db';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pino } from 'pino';
import { createMcpServer } from './server';

const config = loadConfig();
const logger = pino({ level: config.logLevel });

const { db } = createDb({
  url: config.databaseUrl,
  ...(config.databaseAuthToken !== undefined ? { authToken: config.databaseAuthToken } : {}),
});
const services = createServices(db);
const server = createMcpServer({ db, services });

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info({ baseUrl: config.baseUrl }, 'pantrymind mcp server connected on stdio');
