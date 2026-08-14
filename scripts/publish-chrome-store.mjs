import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API_ROOT = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STORE_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const ACCEPTED_STATES = new Set(['PENDING_REVIEW', 'PUBLISHED']);
const ACTIVE_SUBMISSION_STATES = new Set(['PENDING_REVIEW', 'STAGED']);
const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class ChromeStoreError extends Error {
    constructor(message, { retryable = false, cause } = {}) {
        super(message, { cause });
        this.name = 'ChromeStoreError';
        this.retryable = retryable;
    }
}

export function normalizePrivateKey(value) {
    return String(value ?? '')
        .trim()
        .replaceAll('\\n', '\n');
}

export function parseChromeVersion(value) {
    const version = String(value ?? '').trim();
    if (!/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/u.test(version)) {
        throw new ChromeStoreError(`Некорректная версия Chrome: ${JSON.stringify(version)}`);
    }
    const parts = version.split('.').map(Number);
    if (parts.some((part) => part > 65_535)) {
        throw new ChromeStoreError(`Компонент версии Chrome превышает 65535: ${version}`);
    }
    return [...parts, 0, 0, 0, 0].slice(0, 4);
}

export function compareChromeVersions(left, right) {
    const leftParts = parseChromeVersion(left);
    const rightParts = parseChromeVersion(right);
    for (let index = 0; index < leftParts.length; index += 1) {
        if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
    }
    return 0;
}

export function getRevisionVersions(revision) {
    if (!revision || !Array.isArray(revision.distributionChannels)) return [];
    return [
        ...new Set(
            revision.distributionChannels
                .map((channel) => channel?.crxVersion)
                .filter((version) => typeof version === 'string' && version.trim()),
        ),
    ];
}

export function findAcceptedVersion(status, expectedVersion) {
    const revisions = [
        ['submitted', status?.submittedItemRevisionStatus],
        ['published', status?.publishedItemRevisionStatus],
    ];
    for (const [source, revision] of revisions) {
        const expectedDeployment = revision?.distributionChannels?.some(
            (channel) => channel?.crxVersion === expectedVersion && channel?.deployPercentage === 100,
        );
        if (ACCEPTED_STATES.has(revision?.state) && expectedDeployment) {
            return { source, state: revision.state, version: expectedVersion };
        }
    }
    return null;
}

function required(value, name) {
    if (typeof value !== 'string' || !value.trim())
        throw new ChromeStoreError(`Не задано обязательное значение ${name}`);
    return value.trim();
}

function validateIdentifiers(extensionId, publisherId, clientEmail) {
    if (!/^[a-p]{32}$/u.test(extensionId)) {
        throw new ChromeStoreError('CHROME_EXTENSION_ID должен содержать 32 символа от a до p');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(publisherId)) {
        throw new ChromeStoreError('CHROME_PUBLISHER_ID должен быть идентификатором издателя в формате UUID');
    }
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/iu.test(clientEmail)) {
        throw new ChromeStoreError('CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL имеет неверный формат');
    }
}

function parsePositiveInteger(value, fallback, name) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0)
        throw new ChromeStoreError(`${name} должно быть положительным целым числом`);
    return parsed;
}

function encodeBase64Url(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createServiceAccountAssertion(clientEmail, privateKey, nowSeconds = Math.floor(Date.now() / 1000)) {
    const unsigned = `${encodeBase64Url({ alg: 'RS256', typ: 'JWT' })}.${encodeBase64Url({
        iss: clientEmail,
        scope: STORE_SCOPE,
        aud: TOKEN_URL,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
    })}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
    return `${unsigned}.${signature}`;
}

function describeGoogleError(body) {
    const message = body?.error?.message ?? body?.message;
    const details = body?.error?.details ?? body?.details;
    const suffix = details ? `; ${JSON.stringify(details).slice(0, 2_000)}` : '';
    return `${message || 'неизвестная ошибка API'}${suffix}`;
}

async function parseResponse(response, operation) {
    const raw = await response.text();
    let body = {};
    if (raw) {
        try {
            body = JSON.parse(raw);
        } catch {
            body = { message: raw.slice(0, 2_000) };
        }
    }
    if (!response.ok) {
        throw new ChromeStoreError(`${operation}: HTTP ${response.status}: ${describeGoogleError(body)}`, {
            retryable: RETRYABLE_HTTP_STATUSES.has(response.status),
        });
    }
    return body;
}

async function requestAccessToken(fetchImpl, clientEmail, privateKey) {
    const assertion = createServiceAccountAssertion(clientEmail, privateKey);
    const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }),
    });
    const body = await parseResponse(response, 'Авторизация сервисного аккаунта');
    return required(body.access_token, 'access_token');
}

function createStoreClient({ fetchImpl, accessToken, publisherId, extensionId }) {
    const itemName = `publishers/${publisherId}/items/${extensionId}`;
    const commonHeaders = {
        authorization: `Bearer ${accessToken}`,
        'x-goog-api-version': '2',
    };

    return {
        async fetchStatus() {
            const response = await fetchImpl(`${API_ROOT}/v2/${itemName}:fetchStatus`, {
                headers: commonHeaders,
            });
            return parseResponse(response, 'Получение статуса Chrome Web Store');
        },
        async cancelSubmission() {
            const response = await fetchImpl(`${API_ROOT}/v2/${itemName}:cancelSubmission`, {
                method: 'POST',
                headers: { ...commonHeaders, 'content-type': 'application/json' },
                body: '{}',
            });
            return parseResponse(response, 'Отмена предыдущей заявки Chrome Web Store');
        },
        async upload(zip) {
            const response = await fetchImpl(`${API_ROOT}/upload/v2/${itemName}:upload`, {
                method: 'POST',
                headers: {
                    ...commonHeaders,
                    'content-type': 'application/zip',
                    'content-length': String(zip.length),
                },
                body: zip,
            });
            return parseResponse(response, 'Загрузка ZIP в Chrome Web Store');
        },
        async publish() {
            const response = await fetchImpl(`${API_ROOT}/v2/${itemName}:publish`, {
                method: 'POST',
                headers: { ...commonHeaders, 'content-type': 'application/json' },
                body: JSON.stringify({
                    publishType: 'DEFAULT_PUBLISH',
                    skipReview: false,
                    blockOnWarnings: true,
                    deployInfos: [{ deployPercentage: 100 }],
                }),
            });
            return parseResponse(response, 'Отправка версии на проверку Chrome Web Store');
        },
    };
}

function getSubmittedRevision(status) {
    const revision = status?.submittedItemRevisionStatus;
    if (!revision) return null;
    return { state: revision.state, versions: getRevisionVersions(revision) };
}

function assertNoNewerSubmission(status, expectedVersion) {
    const revision = getSubmittedRevision(status);
    for (const version of revision?.versions ?? []) {
        if (compareChromeVersions(version, expectedVersion) > 0) {
            throw new ChromeStoreError(
                `В магазине уже находится более новая заявка ${version}; версия ${expectedVersion} не будет загружена поверх неё`,
            );
        }
    }
}

function assertExpectedSubmissionIsActionable(status, expectedVersion) {
    const revision = getSubmittedRevision(status);
    if (!revision?.versions.includes(expectedVersion)) return;
    if (revision.state === 'STAGED') {
        throw new ChromeStoreError(
            `Версия ${expectedVersion} одобрена, но отложена для ручной публикации в Chrome Web Store`,
        );
    }
    if (revision.state === 'PUBLISHED_TO_TESTERS') {
        throw new ChromeStoreError(`Версия ${expectedVersion} опубликована только для доверенных тестировщиков`);
    }
    if (revision.state === 'REJECTED') {
        throw new ChromeStoreError(`Chrome Web Store отклонил версию ${expectedVersion}`);
    }
}

async function waitForUpload(client, wait, attempts, delayMs) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const status = await client.fetchStatus();
        if (status.lastAsyncUploadState === 'SUCCEEDED') return;
        if (status.lastAsyncUploadState === 'FAILURE') {
            throw new ChromeStoreError('Chrome Web Store сообщил об ошибке асинхронной загрузки ZIP');
        }
        if (attempt < attempts) await wait(delayMs);
    }
    throw new ChromeStoreError('Chrome Web Store не завершил загрузку ZIP за отведённое время', { retryable: true });
}

async function waitForExpectedVersion(client, expectedVersion, wait, attempts, delayMs) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const status = await client.fetchStatus();
        const accepted = findAcceptedVersion(status, expectedVersion);
        if (accepted) return accepted;
        assertNoNewerSubmission(status, expectedVersion);
        assertExpectedSubmissionIsActionable(status, expectedVersion);
        if (attempt < attempts) await wait(delayMs);
    }
    return null;
}

function createResult(accepted, attempts) {
    return { ...accepted, attempts };
}

export async function publishChromeExtension(options, dependencies = {}) {
    const extensionId = required(options.extensionId, 'CHROME_EXTENSION_ID');
    const publisherId = required(options.publisherId, 'CHROME_PUBLISHER_ID');
    const clientEmail = required(options.clientEmail, 'CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL');
    const privateKey = normalizePrivateKey(required(options.privateKey, 'CHROME_SERVICE_ACCOUNT_PRIVATE_KEY'));
    const expectedVersion = required(options.expectedVersion, 'CHROME_EXPECTED_VERSION');
    parseChromeVersion(expectedVersion);
    validateIdentifiers(extensionId, publisherId, clientEmail);

    const maxAttempts = parsePositiveInteger(options.maxAttempts, 3, 'CHROME_MAX_ATTEMPTS');
    const pollAttempts = parsePositiveInteger(options.pollAttempts, 12, 'CHROME_POLL_ATTEMPTS');
    const pollDelayMs = parsePositiveInteger(options.pollDelayMs, 2_500, 'CHROME_POLL_DELAY_MS');
    const retryDelayMs = parsePositiveInteger(options.retryDelayMs, 3_000, 'CHROME_RETRY_DELAY_MS');
    const fetchImpl = dependencies.fetch ?? globalThis.fetch;
    const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const readFile = dependencies.readFile ?? fs.readFile;
    const logger = dependencies.logger ?? console;
    if (typeof fetchImpl !== 'function') throw new ChromeStoreError('В текущей версии Node.js отсутствует fetch');

    const zip = options.zipBuffer ?? (await readFile(required(options.zipPath, 'CHROME_ZIP')));
    if (!Buffer.isBuffer(zip) || zip.length === 0) throw new ChromeStoreError('Chrome ZIP пуст или недоступен');

    const accessToken =
        dependencies.accessToken ?? (await requestAccessToken(fetchImpl, clientEmail, normalizePrivateKey(privateKey)));
    const client = createStoreClient({ fetchImpl, accessToken, publisherId, extensionId });
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const currentStatus = await client.fetchStatus();
            const alreadyAccepted = findAcceptedVersion(currentStatus, expectedVersion);
            if (alreadyAccepted) {
                logger.info(
                    `Chrome Web Store: версия ${expectedVersion} уже имеет статус ${alreadyAccepted.state} (${alreadyAccepted.source}).`,
                );
                return createResult(alreadyAccepted, attempt - 1);
            }
            assertNoNewerSubmission(currentStatus, expectedVersion);
            assertExpectedSubmissionIsActionable(currentStatus, expectedVersion);

            const currentSubmission = getSubmittedRevision(currentStatus);
            if (currentSubmission && ACTIVE_SUBMISSION_STATES.has(currentSubmission.state)) {
                logger.warn(
                    `Chrome Web Store: отменяем более старую заявку ${currentSubmission.versions.join(', ') || 'без версии'} (${currentSubmission.state}).`,
                );
                await client.cancelSubmission();
            }

            logger.info(`Chrome Web Store: попытка ${attempt}/${maxAttempts}, загрузка версии ${expectedVersion}.`);
            const upload = await client.upload(zip);
            if (upload.crxVersion && upload.crxVersion !== expectedVersion) {
                throw new ChromeStoreError(
                    `Chrome Web Store распознал ZIP как версию ${upload.crxVersion}, ожидалась ${expectedVersion}`,
                );
            }
            if (upload.uploadState === 'UPLOAD_IN_PROGRESS') {
                await waitForUpload(client, wait, pollAttempts, pollDelayMs);
            } else if (upload.uploadState !== 'SUCCEEDED') {
                throw new ChromeStoreError(
                    `Chrome Web Store вернул состояние загрузки ${upload.uploadState || 'UNKNOWN'}`,
                    {
                        retryable: upload.uploadState !== 'FAILURE',
                    },
                );
            }

            const submission = await client.publish();
            if (!ACCEPTED_STATES.has(submission.state)) {
                throw new ChromeStoreError(
                    `Chrome Web Store не принял версию: состояние ${submission.state || 'UNKNOWN'}`,
                    { retryable: submission.state === 'CANCELLED' || !submission.state },
                );
            }

            const accepted = await waitForExpectedVersion(client, expectedVersion, wait, pollAttempts, pollDelayMs);
            if (!accepted) {
                throw new ChromeStoreError(`Chrome Web Store не подтвердил версию ${expectedVersion} после отправки`, {
                    retryable: true,
                });
            }
            logger.info(`Chrome Web Store: версия ${expectedVersion} подтверждена со статусом ${accepted.state}.`);
            return createResult(accepted, attempt);
        } catch (error) {
            const storeError =
                error instanceof ChromeStoreError
                    ? error
                    : new ChromeStoreError(`Непредвиденная ошибка Chrome Web Store: ${error.message}`, {
                          cause: error,
                          retryable: true,
                      });
            lastError = storeError;
            if (!storeError.retryable || attempt === maxAttempts) throw storeError;
            logger.warn(`${storeError.message}. Повторяем отправку после паузы.`);
            await wait(retryDelayMs * attempt);
        }
    }

    throw lastError ?? new ChromeStoreError('Chrome Web Store: отправка не завершена');
}

function optionsFromEnvironment(environment) {
    return {
        extensionId: environment.CHROME_EXTENSION_ID,
        publisherId: environment.CHROME_PUBLISHER_ID,
        clientEmail: environment.CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL,
        privateKey: environment.CHROME_SERVICE_ACCOUNT_PRIVATE_KEY,
        expectedVersion: environment.CHROME_EXPECTED_VERSION,
        zipPath: environment.CHROME_ZIP,
        maxAttempts: environment.CHROME_MAX_ATTEMPTS,
        pollAttempts: environment.CHROME_POLL_ATTEMPTS,
        pollDelayMs: environment.CHROME_POLL_DELAY_MS,
        retryDelayMs: environment.CHROME_RETRY_DELAY_MS,
    };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
    publishChromeExtension(optionsFromEnvironment(process.env)).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
