/**
 * email.service unit tests
 *
 * Guards the Resend integration's failure handling. The Resend v6 SDK does NOT
 * throw on API errors (unverified sender domain, invalid/restricted key, bad
 * `from`); it resolves to `{ data: null, error: {...} }`. The service MUST
 * inspect that `error` and surface the failure, otherwise a send that never
 * left is falsely reported as `sent: true` (the forgot-password silent-failure
 * bug).
 */

// ── Mock the Resend SDK ────────────────────────────────────────────────
const mockSend = jest.fn();
jest.mock('resend', () => ({
    Resend: jest.fn().mockImplementation(() => ({
        emails: { send: (...args) => mockSend(...args) },
    })),
}));

const ORIGINAL_ENV = { ...process.env };

describe('email.service.sendEmail', () => {
    let sendEmail;
    let warnSpy;
    let errorSpy;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env = { ...ORIGINAL_ENV };
        process.env.RESEND_API_KEY = 'test-resend-key';
        process.env.EMAIL_FROM = 'EasyModerator <no-reply@easymod.tech>';
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        ({ sendEmail } = require('../email.service'));
    });

    afterEach(() => {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
        process.env = { ...ORIGINAL_ENV };
    });

    it('returns { sent: false } and warns (does not call Resend) when RESEND_API_KEY is unset', async () => {
        delete process.env.RESEND_API_KEY;
        jest.resetModules();
        ({ sendEmail } = require('../email.service'));

        const result = await sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'x' });

        expect(result.sent).toBe(false);
        expect(mockSend).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
    });

    it('returns { sent: true } when Resend accepts the send', async () => {
        mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null });

        const result = await sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'x' });

        expect(result.sent).toBe(true);
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('returns { sent: false } and logs the error when Resend rejects the send (e.g. unverified domain)', async () => {
        // Resend's contract on failure: resolves (does NOT throw) with an error object.
        mockSend.mockResolvedValue({
            data: null,
            error: { name: 'validation_error', message: 'The easymod.co domain is not verified.' },
        });

        const result = await sendEmail({ to: 'owner@example.com', subject: 'Reset', text: 'link' });

        // The send did not happen — the result must reflect that, not lie.
        expect(result.sent).toBe(false);
        // And the failure must be visible in logs for ops/debugging.
        expect(errorSpy).toHaveBeenCalled();
    });
});
