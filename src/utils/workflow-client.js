const { AppError } = require('src/utils/AppError');

async function postToWorkflow(workflowUrl, payload) {
    if (!workflowUrl) {
        throw new AppError('Workflow URL not configured', 500);
    }

    const response = await fetch(workflowUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload || {})
    });

    if (!response.ok) {
        const text = await response.text();
        throw new AppError(`Workflow call failed: ${response.status} ${text}`, 502);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }

    return { ok: true };
}

module.exports = {
    postToWorkflow
};
