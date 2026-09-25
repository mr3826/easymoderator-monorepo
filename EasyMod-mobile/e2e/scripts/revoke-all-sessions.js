'use strict';

/* global apiBaseUrl, email, http, json, output, password */

const baseUrl = String(apiBaseUrl || '').replace(/\/$/, '');
const requestHeaders = {
  'Content-Type': 'application/json',
  'X-EM-Client': 'maestro-wave25',
};

const signinResponse = http.post(`${baseUrl}/api/auth/native/signin`, {
  body: JSON.stringify({ email, password }),
  headers: requestHeaders,
});
if (!signinResponse.ok) {
  throw new Error(
    `BLOCKED: disposable native sign-in for session recovery returned HTTP ${signinResponse.status}.`,
  );
}

const signinBody = json(signinResponse.body);
const signinData = signinBody && signinBody.data;
if (signinData && signinData.requires2fa) {
  throw new Error(
    'BLOCKED: the disposable seed owner requires 2FA, so session expiry recovery cannot run deterministically.',
  );
}
const accessToken = signinData && signinData.accessToken;
if (!accessToken) {
  throw new Error(
    'BLOCKED: disposable native sign-in returned no access token for session recovery.',
  );
}

const authHeaders = {
  ...requestHeaders,
  Authorization: `Bearer ${accessToken}`,
};
const sessionsResponse = http.get(`${baseUrl}/api/auth/native/sessions`, {
  headers: authHeaders,
});
if (!sessionsResponse.ok) {
  throw new Error(
    `BLOCKED: disposable native session listing returned HTTP ${sessionsResponse.status}.`,
  );
}

const sessionsBody = json(sessionsResponse.body);
const sessions =
  sessionsBody && sessionsBody.data && sessionsBody.data.sessions;
if (!Array.isArray(sessions) || sessions.length === 0) {
  throw new Error(
    'BLOCKED: disposable native session listing returned no revocable sessions.',
  );
}

const nonCurrentSessions = sessions.filter(
  (session) => session && session.isCurrent !== true,
);
if (nonCurrentSessions.length === 0) {
  throw new Error(
    'BLOCKED: disposable native session listing contained no non-current app session to revoke.',
  );
}

for (const session of nonCurrentSessions) {
  if (!session || typeof session.id !== 'string' || session.id.length === 0) {
    throw new Error(
      'BLOCKED: disposable native session listing contained an invalid session id.',
    );
  }
  const revokeResponse = http.delete(
    `${baseUrl}/api/auth/native/sessions/${encodeURIComponent(session.id)}`,
    {
      headers: authHeaders,
    },
  );
  if (!revokeResponse.ok) {
    throw new Error(
      `BLOCKED: disposable native session revoke returned HTTP ${revokeResponse.status}.`,
    );
  }
}

output.revokedSessionCount = nonCurrentSessions.length;
console.log(
  `Wave 2.5 session recovery revoked ${nonCurrentSessions.length} disposable native sessions.`,
);
