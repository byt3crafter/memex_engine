import { createServices } from '@pantrymind/core';
import { createDb } from '@pantrymind/db';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from './server';

describe('mcp server skeleton', () => {
  it('createMcpServer returns a constructed server without throwing', () => {
    const { db } = createDb({ url: 'file::memory:' });
    const services = createServices(db);
    const server = createMcpServer({ db, services });
    expect(server).toBeDefined();
  });
});
