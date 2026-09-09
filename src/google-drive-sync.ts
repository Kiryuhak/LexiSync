import { logger } from './logger';
import { getStoredGoogleDriveToken, setStoredGoogleDriveToken } from './secret-store';

const GOOGLE_DRIVE_BACKUP_FILENAME = 'lexisync_backup.enc';
const STORAGE_KEY_DRIVE_LAST_SYNC = 'googleDriveLastSync';

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

export async function getGoogleDriveToken(): Promise<string> {
    try {
        return await getStoredGoogleDriveToken();
    } catch {
        return '';
    }
}

export async function setGoogleDriveToken(token: string): Promise<void> {
    await setStoredGoogleDriveToken(token);
}

export async function disconnectGoogleDrive(): Promise<void> {
    await Promise.all([setStoredGoogleDriveToken(''), chrome.storage.local.remove(STORAGE_KEY_DRIVE_LAST_SYNC)]);
}

export async function findDriveBackupFile(token: string): Promise<GoogleDriveBackupInfo> {
    const cleanToken = token.trim();
    if (!cleanToken) {
        throw new Error('NO_TOKEN');
    }

    const query = encodeURIComponent(`name = '${GOOGLE_DRIVE_BACKUP_FILENAME}' and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime,size)`;

    let response: Response;
    try {
        response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${cleanToken}`,
            },
        });
    } catch (err) {
        logger.error('Сетевая ошибка при запросе к Google Drive API:', err);
        throw new Error('NETWORK_ERROR', { cause: err });
    }

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error('UNAUTHORIZED');
        }
        throw new Error(`DRIVE_API_ERROR: ${response.status}`);
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
    token?: string,
): Promise<{ content: string; modifiedTime?: string }> {
    const activeToken = token || (await getGoogleDriveToken());
    if (!activeToken) {
        throw new Error('NO_TOKEN');
    }

    const info = await findDriveBackupFile(activeToken);
    if (!info.exists || !info.fileId) {
        throw new Error('FILE_NOT_FOUND');
    }

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(info.fileId)}?alt=media`;
    let response: Response;
    try {
        response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${activeToken}`,
            },
        });
    } catch (err) {
        logger.error('Сетевая ошибка при скачивании из Google Drive:', err);
        throw new Error('NETWORK_ERROR', { cause: err });
    }

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error('UNAUTHORIZED');
        }
        throw new Error(`DRIVE_API_ERROR: ${response.status}`);
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
    token?: string,
): Promise<{ fileId: string; modifiedTime: string }> {
    const activeToken = token || (await getGoogleDriveToken());
    if (!activeToken) {
        throw new Error('NO_TOKEN');
    }

    const info = await findDriveBackupFile(activeToken);

    if (info.exists && info.fileId) {
        // Обновляем существующий файл через PATCH
        const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(info.fileId)}?uploadType=media`;
        let response: Response;
        try {
            response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${activeToken}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                },
                body: encryptedJson,
            });
        } catch (err) {
            logger.error('Сетевая ошибка при обновлении бэкапа в Google Drive:', err);
            throw new Error('NETWORK_ERROR', { cause: err });
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error('UNAUTHORIZED');
            }
            throw new Error(`DRIVE_API_ERROR: ${response.status}`);
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
    let createResponse: Response;
    try {
        createResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${activeToken}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody,
        });
    } catch (err) {
        logger.error('Сетевая ошибка при создании файла в Google Drive:', err);
        throw new Error('NETWORK_ERROR', { cause: err });
    }

    if (!createResponse.ok) {
        if (createResponse.status === 401 || createResponse.status === 403) {
            throw new Error('UNAUTHORIZED');
        }
        throw new Error(`DRIVE_API_ERROR: ${createResponse.status}`);
    }

    const createData = (await createResponse.json()) as { id: string; modifiedTime?: string };
    const modifiedTime = createData.modifiedTime || new Date().toISOString();
    await chrome.storage.local.set({ [STORAGE_KEY_DRIVE_LAST_SYNC]: Date.now() });
    return { fileId: createData.id, modifiedTime };
}
