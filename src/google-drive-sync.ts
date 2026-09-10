import { logger } from './logger';
import { GOOGLE_DRIVE_ERROR } from './google-drive-errors';

const GOOGLE_DRIVE_BACKUP_FILENAME = 'lexisync_backup.enc';
const STORAGE_KEY_DRIVE_LAST_SYNC = 'googleDriveLastSync';
const GOOGLE_DRIVE_REQUEST_TIMEOUT_MS = 20_000;

export interface GoogleDriveBackupInfo {
    exists: boolean;
    fileId?: string;
    modifiedTime?: string;
    size?: number;
}

export interface GoogleDriveSyncStatus {
    connected: boolean;
    lastSyncTime?: number;
    backupInfo?: GoogleDriveBackupInfo;
}

async function readGoogleDriveErrorReasons(response: Response): Promise<string[]> {
    try {
        const body = (await response.clone().json()) as {
            error?:
                | string
                | {
                      status?: string;
                      errors?: Array<{ reason?: string }>;
                  };
        };
        if (typeof body.error === 'string') return [body.error];
        return [body.error?.status, ...(body.error?.errors?.map((entry) => entry.reason) || [])].filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
        );
    } catch {
        return [];
    }
}

async function throwGoogleDriveResponseError(response: Response): Promise<never> {
    if (response.status === 401) throw new Error(GOOGLE_DRIVE_ERROR.AUTH);

    const reasons = (await readGoogleDriveErrorReasons(response)).map((reason) => reason.toLowerCase());
    if (
        reasons.some((reason) =>
            ['autherror', 'invalidcredentials', 'invalid_token', 'unauthenticated'].includes(reason),
        )
    ) {
        throw new Error(GOOGLE_DRIVE_ERROR.AUTH);
    }
    if (reasons.includes('accessnotconfigured')) throw new Error(GOOGLE_DRIVE_ERROR.API_NOT_ENABLED);
    if (reasons.includes('insufficientpermissions')) throw new Error(GOOGLE_DRIVE_ERROR.INSUFFICIENT_PERMISSIONS);
    if (
        response.status === 429 ||
        reasons.some((reason) => ['quotaexceeded', 'ratelimitexceeded', 'userratelimitexceeded'].includes(reason))
    ) {
        throw new Error(GOOGLE_DRIVE_ERROR.RATE_LIMIT);
    }
    if (response.status === 403) throw new Error(GOOGLE_DRIVE_ERROR.FORBIDDEN);
    throw new Error(`DRIVE_API_ERROR: ${response.status}`);
}

async function fetchGoogleDrive(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), GOOGLE_DRIVE_REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
        if (controller.signal.aborted) throw new Error(GOOGLE_DRIVE_ERROR.TIMEOUT, { cause: error });
        logger.error('Сетевая ошибка при обращении к Google Drive API:', error);
        throw new Error(GOOGLE_DRIVE_ERROR.NETWORK, { cause: error });
    } finally {
        globalThis.clearTimeout(timeout);
    }
}

export async function findDriveBackupFile(token: string): Promise<GoogleDriveBackupInfo> {
    const cleanToken = token.trim();
    if (!cleanToken) {
        throw new Error('NO_TOKEN');
    }

    const query = encodeURIComponent(`name = '${GOOGLE_DRIVE_BACKUP_FILENAME}' and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime,size)`;

    const response = await fetchGoogleDrive(url, {
        headers: {
            Authorization: `Bearer ${cleanToken}`,
        },
    });

    if (!response.ok) {
        await throwGoogleDriveResponseError(response);
    }

    const data = (await response.json()) as {
        files?: Array<{ id: string; name: string; modifiedTime?: string; size?: string }>;
    };

    const file = data.files?.[0];
    if (!file) {
        return { exists: false };
    }

    return {
        exists: true,
        fileId: file.id,
        modifiedTime: file.modifiedTime,
        size: Number(file.size) || 0,
    };
}

export async function downloadBackupFromGoogleDrive(
    token: string,
): Promise<{ content: string; modifiedTime?: string }> {
    const activeToken = token.trim();
    if (!activeToken) {
        throw new Error('NO_TOKEN');
    }

    const info = await findDriveBackupFile(activeToken);
    if (!info.exists || !info.fileId) {
        throw new Error('FILE_NOT_FOUND');
    }

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(info.fileId)}?alt=media`;
    const response = await fetchGoogleDrive(url, {
        headers: {
            Authorization: `Bearer ${activeToken}`,
        },
    });

    if (!response.ok) {
        await throwGoogleDriveResponseError(response);
    }

    const content = await response.text();
    await chrome.storage.local.set({ [STORAGE_KEY_DRIVE_LAST_SYNC]: Date.now() });

    return {
        content,
        modifiedTime: info.modifiedTime,
    };
}

export async function uploadBackupToGoogleDrive(
    encryptedJson: string,
    token: string,
): Promise<{ fileId: string; modifiedTime: string }> {
    const activeToken = token.trim();
    if (!activeToken) {
        throw new Error('NO_TOKEN');
    }

    const info = await findDriveBackupFile(activeToken);

    if (info.exists && info.fileId) {
        // Обновляем существующий файл через PATCH
        const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(info.fileId)}?uploadType=media`;
        const response = await fetchGoogleDrive(url, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${activeToken}`,
                'Content-Type': 'application/json; charset=UTF-8',
            },
            body: encryptedJson,
        });

        if (!response.ok) {
            await throwGoogleDriveResponseError(response);
        }

        const data = (await response.json()) as { id: string; modifiedTime?: string };
        const modifiedTime = data.modifiedTime || new Date().toISOString();
        await chrome.storage.local.set({ [STORAGE_KEY_DRIVE_LAST_SYNC]: Date.now() });
        return { fileId: data.id || info.fileId, modifiedTime };
    }

    // Создаем новый файл в appDataFolder через multipart upload
    const metadata = {
        name: GOOGLE_DRIVE_BACKUP_FILENAME,
        parents: ['appDataFolder'],
    };

    const boundary = '-------LexiSyncMultipartBoundary' + Math.random().toString(36).substring(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        encryptedJson +
        closeDelimiter;

    const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const createResponse = await fetchGoogleDrive(uploadUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${activeToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
    });

    if (!createResponse.ok) {
        await throwGoogleDriveResponseError(createResponse);
    }

    const createData = (await createResponse.json()) as { id: string; modifiedTime?: string };
    const modifiedTime = createData.modifiedTime || new Date().toISOString();
    await chrome.storage.local.set({ [STORAGE_KEY_DRIVE_LAST_SYNC]: Date.now() });
    return { fileId: createData.id, modifiedTime };
}
