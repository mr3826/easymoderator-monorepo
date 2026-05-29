'use strict';

const { extractCommentEvents } = require('../comment-to-dm.webhook-handler');

// ── Facebook feed payload fixtures ───────────────────────────────────────────

const FB_COMMENT_PAYLOAD = {
    object: 'page',
    entry: [
        {
            id: 'PAGE_123',
            changes: [
                {
                    field: 'feed',
                    value: {
                        item: 'comment',
                        comment_id: 'CMT_001',
                        post_id: 'POST_A',
                        from: { id: 'USER_456', name: 'Rahim Uddin' },
                        message: 'price ki?',
                        parent_id: null,
                        created_time: 1700000000,
                    },
                },
            ],
            messaging: [],
        },
    ],
};

const FB_PAGE_OWN_COMMENT = {
    object: 'page',
    entry: [
        {
            id: 'PAGE_123',
            changes: [
                {
                    field: 'feed',
                    value: {
                        item: 'comment',
                        comment_id: 'CMT_OWN',
                        post_id: 'POST_A',
                        from: { id: 'PAGE_123', name: 'My Page' }, // same as page id → echo
                        message: 'Thank you!',
                        created_time: 1700000001,
                    },
                },
            ],
        },
    ],
};

const FB_NON_COMMENT_CHANGE = {
    object: 'page',
    entry: [
        {
            id: 'PAGE_123',
            changes: [
                {
                    field: 'feed',
                    value: { item: 'status' }, // not a comment
                },
            ],
        },
    ],
};

const FB_WITH_PARENT_COMMENT = {
    object: 'page',
    entry: [
        {
            id: 'PAGE_123',
            changes: [
                {
                    field: 'feed',
                    value: {
                        item: 'comment',
                        comment_id: 'CMT_REPLY',
                        post_id: 'POST_B',
                        parent_id: 'CMT_001',
                        from: { id: 'USER_789', name: 'Karim' },
                        message: 'ami o janbar chai',
                        created_time: 1700000002,
                    },
                },
            ],
        },
    ],
};

// ── Instagram comment payload fixtures ───────────────────────────────────────

const IG_COMMENT_PAYLOAD = {
    object: 'instagram',
    entry: [
        {
            id: 'IG_ACC_111',
            changes: [
                {
                    field: 'comments',
                    value: {
                        id: 'IG_CMT_A',
                        text: 'ki dam?',
                        from: { id: 'IG_USER_222', username: 'buyer1' },
                        media: { id: 'IG_MEDIA_333' },
                    },
                },
            ],
            messaging: [],
        },
    ],
};

const IG_PAGE_OWN_COMMENT = {
    object: 'instagram',
    entry: [
        {
            id: 'IG_ACC_111',
            changes: [
                {
                    field: 'comments',
                    value: {
                        id: 'IG_CMT_OWN',
                        text: 'stock shesh',
                        from: { id: 'IG_ACC_111', username: 'myshop' }, // same as account id → echo
                        media: { id: 'IG_MEDIA_333' },
                    },
                },
            ],
        },
    ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extractCommentEvents — Facebook', () => {

    test('parses a well-formed FB feed comment into normalized shape', () => {
        const events = extractCommentEvents(FB_COMMENT_PAYLOAD, 'facebook');
        expect(events).toHaveLength(1);
        const e = events[0];
        expect(e.commentId).toBe('CMT_001');
        expect(e.postId).toBe('POST_A');
        expect(e.parentCommentId).toBeNull();
        expect(e.commenterId).toBe('USER_456');
        expect(e.commenterName).toBe('Rahim Uddin');
        expect(e.text).toBe('price ki?');
        expect(e.pageOrAccountId).toBe('PAGE_123');
    });

    test('filters out echo comments (commenter id === page id)', () => {
        const events = extractCommentEvents(FB_PAGE_OWN_COMMENT, 'facebook');
        expect(events).toHaveLength(0);
    });

    test('ignores non-comment feed changes (status updates etc.)', () => {
        const events = extractCommentEvents(FB_NON_COMMENT_CHANGE, 'facebook');
        expect(events).toHaveLength(0);
    });

    test('sets parentCommentId when present', () => {
        const events = extractCommentEvents(FB_WITH_PARENT_COMMENT, 'facebook');
        expect(events).toHaveLength(1);
        expect(events[0].parentCommentId).toBe('CMT_001');
        expect(events[0].commenterId).toBe('USER_789');
    });

    test('returns empty array for empty entry list', () => {
        const events = extractCommentEvents({ object: 'page', entry: [] }, 'facebook');
        expect(events).toHaveLength(0);
    });

    test('returns empty array for null payload', () => {
        const events = extractCommentEvents(null, 'facebook');
        expect(events).toHaveLength(0);
    });

    test('returns empty array for page with only messaging events (no changes)', () => {
        const payload = {
            object: 'page',
            entry: [{ id: 'PAGE_123', messaging: [{ sender: { id: 'X' } }], changes: [] }],
        };
        const events = extractCommentEvents(payload, 'facebook');
        expect(events).toHaveLength(0);
    });

    test('handles multiple comments across multiple entries', () => {
        const multi = {
            object: 'page',
            entry: [
                {
                    id: 'PAGE_A',
                    changes: [
                        {
                            field: 'feed',
                            value: {
                                item: 'comment',
                                comment_id: 'C1',
                                post_id: 'P1',
                                from: { id: 'U1', name: 'Alice' },
                                message: 'hello',
                                created_time: 1700000010,
                            },
                        },
                    ],
                },
                {
                    id: 'PAGE_B',
                    changes: [
                        {
                            field: 'feed',
                            value: {
                                item: 'comment',
                                comment_id: 'C2',
                                post_id: 'P2',
                                from: { id: 'U2', name: 'Bob' },
                                message: 'world',
                                created_time: 1700000011,
                            },
                        },
                    ],
                },
            ],
        };
        const events = extractCommentEvents(multi, 'facebook');
        expect(events).toHaveLength(2);
        expect(events[0].commentId).toBe('C1');
        expect(events[1].commentId).toBe('C2');
    });
});

describe('extractCommentEvents — Instagram', () => {

    test('parses a well-formed IG comment change into normalized shape', () => {
        const events = extractCommentEvents(IG_COMMENT_PAYLOAD, 'instagram');
        expect(events).toHaveLength(1);
        const e = events[0];
        expect(e.commentId).toBe('IG_CMT_A');
        expect(e.postId).toBe('IG_MEDIA_333');
        expect(e.commenterId).toBe('IG_USER_222');
        expect(e.commenterName).toBe('buyer1');
        expect(e.text).toBe('ki dam?');
        expect(e.pageOrAccountId).toBe('IG_ACC_111');
        expect(e.parentCommentId).toBeNull();
    });

    test('filters out echo comments (commenter id === account id)', () => {
        const events = extractCommentEvents(IG_PAGE_OWN_COMMENT, 'instagram');
        expect(events).toHaveLength(0);
    });

    test('returns empty array for null payload', () => {
        expect(extractCommentEvents(null, 'instagram')).toHaveLength(0);
    });

    test('returns empty array for wrong platform passed for IG payload', () => {
        // Payload is instagram object but platform param says facebook — should return nothing
        // because we only look at `changes.field === 'comments'` for instagram and
        // `changes.field === 'feed'` for facebook.
        const events = extractCommentEvents(IG_COMMENT_PAYLOAD, 'facebook');
        expect(events).toHaveLength(0);
    });
});
