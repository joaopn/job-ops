import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROFILE_PATH = join(__dirname, '../../../../resume-generator/base.json');

let cachedProfile: any = null;

/**
 * Get the base resume profile from base.json.
 * Caches the result since it doesn't change often.
 */
export async function getProfile(forceRefresh = false): Promise<any> {
    if (cachedProfile && !forceRefresh) {
        return cachedProfile;
    }

    try {
        const content = await readFile(DEFAULT_PROFILE_PATH, 'utf-8');
        cachedProfile = JSON.parse(content);
        return cachedProfile;
    } catch (error) {
        console.error('❌ Failed to load profile from base.json:', error);
        return {};
    }
}

/**
 * Get the person's name from the profile.
 */
export async function getPersonName(): Promise<string> {
    const profile = await getProfile();
    return profile?.basics?.name || 'Resume';
}

/**
 * Clear the profile cache.
 */
export function clearProfileCache(): void {
    cachedProfile = null;
}
