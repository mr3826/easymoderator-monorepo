'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockFindAll = () => [];
const mockUser = { findAll: mockFindAll };
const mockShop = { findAll: mockFindAll };
const mockUserShop = { findAll: mockFindAll };
const mockAuditLog = { findAll: jest.fn() };
const mockPartnerApplication = { findAll: jest.fn() };

jest.mock('../../src/modules/entities', () => ({
  AuditLog: mockAuditLog,
  PartnerApplication: mockPartnerApplication,
  User: mockUser,
  Shop: mockShop,
  UserShop: mockUserShop,
}));
jest.mock('../../src/modules/growth-os/growth-os.prospect.service', () => ({
  createImported: jest.fn(async ({ reservations, sourceReference, dryRun }) => {
    if (dryRun && reservations.sourceReferences.has(sourceReference)) {
      return { created: false, skippedDuplicate: true };
    }
    reservations.sourceReferences.add(sourceReference);
    return { created: false, skippedDuplicate: false };
  }),
}));

const { loadRows, parseArgs, run } = require('../import-growth-prospects');
const prospectService = require('../../src/modules/growth-os/growth-os.prospect.service');

describe('Growth prospect importer contract', () => {
  beforeEach(() => {
    mockAuditLog.findAll.mockReset();
    mockPartnerApplication.findAll.mockReset();
    prospectService.createImported.mockClear();
  });

  it('parses bounded, explicit CLI options and keeps dry-run as default', () => {
    expect(parseArgs(['--batch-size', '7', '--run-id=run-1', '--receipt', 'receipt.json']))
      .toMatchObject({ apply: false, batchSize: 7, runId: 'run-1', receipt: 'receipt.json' });
    expect(parseArgs(['--apply', '--batch-size=2']).apply).toBe(true);
    expect(() => parseArgs(['--batch-size', '0'])).toThrow(/batch-size/);
  });

  it('uses deterministic keyset pages and required non-secret attributes', async () => {
    const crmRows = [{ id: 'a', user_id: null, shop_id: null, resource_id: 'r', idempotency_key: 'k', metadata: { business_name: 'A', phone: '01700000000' }, created_at: new Date('2026-01-01') }];
    mockAuditLog.findAll.mockResolvedValueOnce(crmRows).mockResolvedValueOnce([]);
    mockPartnerApplication.findAll.mockResolvedValueOnce([]);
    const rows = [];
    for await (const row of loadRows({ batchSize: 1 })) rows.push(row);
    expect(rows).toHaveLength(1);
    expect(mockAuditLog.findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 1, order: [['created_at', 'ASC'], ['id', 'ASC']] }));
    expect(mockAuditLog.findAll.mock.calls[0][0].attributes).not.toContain('password');
    expect(mockAuditLog.findAll.mock.calls[0][0].attributes).toEqual(expect.arrayContaining(['id', 'metadata', 'created_at']));
  });

  it('writes a structured receipt without retaining result rows in the return value', async () => {
    mockAuditLog.findAll.mockResolvedValue([]);
    mockPartnerApplication.findAll.mockResolvedValue([]);
    const receipt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'growth-import-unit-')), 'receipt.json');
    const result = await run({ runId: 'receipt-test', batchSize: 2, receipt });
    expect(result).not.toHaveProperty('results');
    expect(JSON.parse(fs.readFileSync(receipt, 'utf8'))).toMatchObject({ runId: 'receipt-test', rows: [] });
  });
});
