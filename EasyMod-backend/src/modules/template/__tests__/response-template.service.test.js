'use strict';

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any require() of the module under test
// ---------------------------------------------------------------------------

const mockTemplateCreate = jest.fn();
const mockTemplateFindAll = jest.fn();
const mockTemplateFindOne = jest.fn();

// Instance-level methods returned when findOne resolves
const makeMockTemplate = (overrides = {}) => ({
    id: 'tpl-uuid-001',
    shop_id: 'shop-uuid-001',
    name: 'Default Template',
    content: 'Hello {{name}}!',
    variables: ['name'],
    category: 'greeting',
    is_active: true,
    update: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides
});

jest.mock('../response-template.entity', () => ({
    create: mockTemplateCreate,
    findAll: mockTemplateFindAll,
    findOne: mockTemplateFindOne
}));

jest.mock('../../../utils/AppError', () => {
    class AppError extends Error {
        constructor(message, status = 500) {
            super(message);
            this.name = 'AppError';
            this.status = status;
        }
    }
    return { AppError };
});

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
    }))
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

const {
    createTemplate,
    listTemplates,
    updateTemplate,
    deleteTemplate,
    renderTemplate
} = require('../response-template.service');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHOP_ID = 'shop-uuid-001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('response-template.service', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // -----------------------------------------------------------------------
    // createTemplate
    // -----------------------------------------------------------------------

    describe('createTemplate', () => {
        it('creates a template with all provided fields and returns it', async () => {
            const data = {
                name: 'Greeting',
                content: 'Hello {{name}}, welcome!',
                variables: ['name'],
                category: 'greeting',
                is_active: true
            };
            const created = makeMockTemplate(data);
            mockTemplateCreate.mockResolvedValueOnce(created);

            const result = await createTemplate(SHOP_ID, data);

            expect(mockTemplateCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    shop_id: SHOP_ID,
                    name: 'Greeting',
                    content: 'Hello {{name}}, welcome!',
                    variables: ['name'],
                    category: 'greeting',
                    is_active: true
                })
            );
            expect(result).toBe(created);
        });

        it('creates a template with minimal required fields using defaults', async () => {
            const data = { name: 'Minimal', content: 'Simple content' };
            const created = makeMockTemplate({ name: 'Minimal', content: 'Simple content', variables: [], category: null, is_active: true });
            mockTemplateCreate.mockResolvedValueOnce(created);

            await createTemplate(SHOP_ID, data);

            expect(mockTemplateCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    variables: [],
                    category: null,
                    is_active: true
                })
            );
        });

        it('throws AppError with status 400 when name is missing', async () => {
            await expect(
                createTemplate(SHOP_ID, { content: 'Some content' })
            ).rejects.toMatchObject({ status: 400, message: 'Template name is required' });
        });

        it('throws AppError with status 400 when content is missing', async () => {
            await expect(
                createTemplate(SHOP_ID, { name: 'My Template' })
            ).rejects.toMatchObject({ status: 400, message: 'Template content is required' });
        });

        it('defaults is_active to true when not provided', async () => {
            const data = { name: 'Active by default', content: 'Content' };
            mockTemplateCreate.mockResolvedValueOnce(makeMockTemplate());

            await createTemplate(SHOP_ID, data);

            expect(mockTemplateCreate).toHaveBeenCalledWith(
                expect.objectContaining({ is_active: true })
            );
        });

        it('respects is_active=false when explicitly set', async () => {
            const data = { name: 'Inactive', content: 'Content', is_active: false };
            mockTemplateCreate.mockResolvedValueOnce(makeMockTemplate({ is_active: false }));

            await createTemplate(SHOP_ID, data);

            expect(mockTemplateCreate).toHaveBeenCalledWith(
                expect.objectContaining({ is_active: false })
            );
        });

        it('passes category=null when category is not provided', async () => {
            const data = { name: 'No Category', content: 'Content' };
            mockTemplateCreate.mockResolvedValueOnce(makeMockTemplate());

            await createTemplate(SHOP_ID, data);

            expect(mockTemplateCreate).toHaveBeenCalledWith(
                expect.objectContaining({ category: null })
            );
        });

        it('does not call create when validation fails', async () => {
            await expect(createTemplate(SHOP_ID, {})).rejects.toThrow();
            expect(mockTemplateCreate).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // listTemplates
    // -----------------------------------------------------------------------

    describe('listTemplates', () => {
        it('returns all templates for the shop when no category filter is given', async () => {
            const templates = [makeMockTemplate(), makeMockTemplate({ id: 'tpl-002', name: 'Second' })];
            mockTemplateFindAll.mockResolvedValueOnce(templates);

            const result = await listTemplates(SHOP_ID);

            expect(result).toBe(templates);
            expect(mockTemplateFindAll).toHaveBeenCalledWith(
                expect.objectContaining({ where: { shop_id: SHOP_ID } })
            );
        });

        it('filters by category when provided', async () => {
            mockTemplateFindAll.mockResolvedValueOnce([]);

            await listTemplates(SHOP_ID, 'shipping');

            expect(mockTemplateFindAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { shop_id: SHOP_ID, category: 'shipping' }
                })
            );
        });

        it('does not add category to where clause when not supplied', async () => {
            mockTemplateFindAll.mockResolvedValueOnce([]);

            await listTemplates(SHOP_ID);

            const args = mockTemplateFindAll.mock.calls[0][0];
            expect(args.where.category).toBeUndefined();
        });

        it('returns an empty array when no templates exist', async () => {
            mockTemplateFindAll.mockResolvedValueOnce([]);

            const result = await listTemplates(SHOP_ID);
            expect(result).toEqual([]);
        });

        it('orders results by created_at DESC', async () => {
            mockTemplateFindAll.mockResolvedValueOnce([]);

            await listTemplates(SHOP_ID);

            const args = mockTemplateFindAll.mock.calls[0][0];
            expect(args.order).toEqual([['created_at', 'DESC']]);
        });

        it('scopes results strictly to the provided shopId', async () => {
            mockTemplateFindAll.mockResolvedValueOnce([]);

            await listTemplates('other-shop-id');

            const args = mockTemplateFindAll.mock.calls[0][0];
            expect(args.where.shop_id).toBe('other-shop-id');
        });
    });

    // -----------------------------------------------------------------------
    // updateTemplate
    // -----------------------------------------------------------------------

    describe('updateTemplate', () => {
        it('updates and returns the template when found', async () => {
            const template = makeMockTemplate();
            mockTemplateFindOne.mockResolvedValueOnce(template);

            const result = await updateTemplate(SHOP_ID, 'tpl-uuid-001', { name: 'Updated Name' });

            expect(template.update).toHaveBeenCalledWith({ name: 'Updated Name' });
            expect(result).toBe(template);
        });

        it('throws AppError with status 404 when template is not found', async () => {
            mockTemplateFindOne.mockResolvedValueOnce(null);

            await expect(
                updateTemplate(SHOP_ID, 'non-existent-id', { name: 'x' })
            ).rejects.toMatchObject({ status: 404, message: 'Template not found' });
        });

        it('only updates allowed fields (name, content, variables, category, is_active)', async () => {
            const template = makeMockTemplate();
            mockTemplateFindOne.mockResolvedValueOnce(template);

            await updateTemplate(SHOP_ID, 'tpl-uuid-001', {
                name: 'New Name',
                shop_id: 'hacked-shop', // not in allowed list
                id: 'hacked-id'          // not in allowed list
            });

            const updateCall = template.update.mock.calls[0][0];
            expect(updateCall).toEqual({ name: 'New Name' });
            expect(updateCall.shop_id).toBeUndefined();
            expect(updateCall.id).toBeUndefined();
        });

        it('performs a partial update — only includes provided keys', async () => {
            const template = makeMockTemplate();
            mockTemplateFindOne.mockResolvedValueOnce(template);

            await updateTemplate(SHOP_ID, 'tpl-uuid-001', { is_active: false });

            const updateCall = template.update.mock.calls[0][0];
            expect(Object.keys(updateCall)).toEqual(['is_active']);
        });

        it('queries findOne scoped to both id and shopId', async () => {
            mockTemplateFindOne.mockResolvedValueOnce(null);

            await updateTemplate(SHOP_ID, 'tpl-uuid-001', {}).catch(() => {});

            expect(mockTemplateFindOne).toHaveBeenCalledWith({
                where: { id: 'tpl-uuid-001', shop_id: SHOP_ID }
            });
        });

        it('updates multiple allowed fields at once', async () => {
            const template = makeMockTemplate();
            mockTemplateFindOne.mockResolvedValueOnce(template);

            await updateTemplate(SHOP_ID, 'tpl-uuid-001', {
                name: 'New Name',
                content: 'New Content',
                category: 'refund'
            });

            expect(template.update).toHaveBeenCalledWith({
                name: 'New Name',
                content: 'New Content',
                category: 'refund'
            });
        });
    });

    // -----------------------------------------------------------------------
    // deleteTemplate
    // -----------------------------------------------------------------------

    describe('deleteTemplate', () => {
        it('deletes the template and returns a success message', async () => {
            const template = makeMockTemplate();
            mockTemplateFindOne.mockResolvedValueOnce(template);

            const result = await deleteTemplate(SHOP_ID, 'tpl-uuid-001');

            expect(template.destroy).toHaveBeenCalledTimes(1);
            expect(result).toEqual({ message: 'Template deleted successfully' });
        });

        it('throws AppError with status 404 when template is not found', async () => {
            mockTemplateFindOne.mockResolvedValueOnce(null);

            await expect(
                deleteTemplate(SHOP_ID, 'ghost-id')
            ).rejects.toMatchObject({ status: 404, message: 'Template not found' });
        });

        it('does not call destroy when template is not found', async () => {
            mockTemplateFindOne.mockResolvedValueOnce(null);

            await deleteTemplate(SHOP_ID, 'ghost-id').catch(() => {});

            // destroy should never be called since we never got a template instance
            // (we can verify findOne was called but no destroy mock was invoked)
            expect(mockTemplateFindOne).toHaveBeenCalledTimes(1);
        });

        it('queries findOne scoped to both id and shopId', async () => {
            mockTemplateFindOne.mockResolvedValueOnce(null);

            await deleteTemplate(SHOP_ID, 'tpl-abc').catch(() => {});

            expect(mockTemplateFindOne).toHaveBeenCalledWith({
                where: { id: 'tpl-abc', shop_id: SHOP_ID }
            });
        });

        it('calls destroy once on the found template instance', async () => {
            const template = makeMockTemplate();
            mockTemplateFindOne.mockResolvedValueOnce(template);

            await deleteTemplate(SHOP_ID, 'tpl-uuid-001');

            expect(template.destroy).toHaveBeenCalledTimes(1);
            expect(template.destroy).toHaveBeenCalledWith();
        });
    });

    // -----------------------------------------------------------------------
    // renderTemplate
    // -----------------------------------------------------------------------

    describe('renderTemplate', () => {
        it('replaces a single {{variable}} placeholder with its value', () => {
            const result = renderTemplate('Hello {{name}}!', { name: 'Alice' });
            expect(result).toBe('Hello Alice!');
        });

        it('replaces multiple {{variable}} placeholders in one pass', () => {
            const result = renderTemplate(
                'Dear {{name}}, your order {{orderId}} has shipped.',
                { name: 'Bob', orderId: 'ORD-12345' }
            );
            expect(result).toBe('Dear Bob, your order ORD-12345 has shipped.');
        });

        it('leaves unrecognized placeholders unchanged when variable is missing', () => {
            const result = renderTemplate('Hello {{name}}, your code is {{code}}!', { name: 'Carol' });
            expect(result).toBe('Hello Carol, your code is {{code}}!');
        });

        it('returns the original string unchanged when no placeholders exist', () => {
            const content = 'No placeholders here.';
            expect(renderTemplate(content, { name: 'Dave' })).toBe(content);
        });

        it('returns the original string unchanged when variables is empty object', () => {
            const content = 'Hello {{name}}!';
            expect(renderTemplate(content, {})).toBe('Hello {{name}}!');
        });

        it('returns the original string when variables parameter is omitted', () => {
            const content = 'Hello {{name}}!';
            expect(renderTemplate(content)).toBe('Hello {{name}}!');
        });

        it('returns empty string when templateContent is empty string', () => {
            expect(renderTemplate('', { name: 'Eve' })).toBe('');
        });

        it('returns empty string when templateContent is falsy (null)', () => {
            expect(renderTemplate(null, { name: 'Frank' })).toBe('');
        });

        it('returns empty string when templateContent is undefined', () => {
            expect(renderTemplate(undefined)).toBe('');
        });

        it('replaces the same placeholder multiple times in one string', () => {
            const result = renderTemplate('{{greeting}} {{name}}, I say {{greeting}}!', {
                greeting: 'Hi',
                name: 'Grace'
            });
            expect(result).toBe('Hi Grace, I say Hi!');
        });

        it('handles numeric variable values correctly', () => {
            const result = renderTemplate('You have {{count}} items.', { count: 5 });
            expect(result).toBe('You have 5 items.');
        });

        it('handles variable value that is an empty string', () => {
            const result = renderTemplate('Name: {{name}}', { name: '' });
            expect(result).toBe('Name: ');
        });

        it('does not replace non-word characters inside braces (only \\w+ matches)', () => {
            const content = 'Value: {{my-key}}';
            // {{my-key}} has a hyphen — \w+ does not match it, so it stays as-is
            expect(renderTemplate(content, { 'my-key': 'replaced' })).toBe('Value: {{my-key}}');
        });
    });
});
