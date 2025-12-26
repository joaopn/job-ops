/**
 * Service for running the UK Visa Jobs extractor (extractors/ukvisajobs).
 * 
 * Spawns the extractor as a child process and reads its output dataset.
 */

import { spawn } from 'child_process';
import { readdir, readFile, rm, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { CreateJobInput } from '../../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UKVISAJOBS_DIR = join(__dirname, '../../../../extractors/ukvisajobs');
const STORAGE_DIR = join(UKVISAJOBS_DIR, 'storage/datasets/default');

export interface RunUkVisaJobsOptions {
    /** Maximum number of jobs to fetch. Defaults to 50, max 200. */
    maxJobs?: number;
    /** Search keyword filter (optional) */
    searchKeyword?: string;
}

export interface UkVisaJobsResult {
    success: boolean;
    jobs: CreateJobInput[];
    error?: string;
}

/**
 * Clear previous extraction results.
 */
async function clearStorageDataset(): Promise<void> {
    try {
        await rm(STORAGE_DIR, { recursive: true, force: true });
    } catch {
        // Ignore if directory doesn't exist
    }
}

/**
 * Run the UK Visa Jobs extractor.
 */
export async function runUkVisaJobs(options: RunUkVisaJobsOptions = {}): Promise<UkVisaJobsResult> {
    console.log('🇬🇧 Running UK Visa Jobs extractor...');

    try {
        // Clear previous results
        await clearStorageDataset();
        await mkdir(STORAGE_DIR, { recursive: true });

        // Run the extractor using npx tsx directly (more reliable in Docker/different environments)
        await new Promise<void>((resolve, reject) => {
            const child = spawn('npx', ['tsx', 'src/main.ts'], {
                cwd: UKVISAJOBS_DIR,
                stdio: 'inherit',
                env: {
                    ...process.env,
                    UKVISAJOBS_MAX_JOBS: String(options.maxJobs ?? 50),
                    UKVISAJOBS_SEARCH_KEYWORD: options.searchKeyword ?? '',
                },
            });

            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`UK Visa Jobs extractor exited with code ${code}`));
            });
            child.on('error', reject);
        });

        // Read the output dataset
        const jobs = await readDataset();
        console.log(`✅ UK Visa Jobs: imported ${jobs.length} jobs`);

        return { success: true, jobs };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ UK Visa Jobs failed: ${message}`);
        return { success: false, jobs: [], error: message };
    }
}

/**
 * Read jobs from the extractor's output dataset.
 */
async function readDataset(): Promise<CreateJobInput[]> {
    const jobs: CreateJobInput[] = [];

    try {
        const files = await readdir(STORAGE_DIR);
        const jsonFiles = files.filter((f) => f.endsWith('.json') && f !== 'jobs.json');

        for (const file of jsonFiles.sort()) {
            try {
                const content = await readFile(join(STORAGE_DIR, file), 'utf-8');
                const job = JSON.parse(content);

                // Map to CreateJobInput format
                jobs.push({
                    source: 'ukvisajobs',
                    sourceJobId: job.sourceJobId,
                    title: job.title || 'Unknown Title',
                    employer: job.employer || 'Unknown Employer',
                    employerUrl: job.employerUrl,
                    jobUrl: job.jobUrl,
                    applicationLink: job.applicationLink || job.jobUrl,
                    location: job.location,
                    deadline: job.deadline,
                    salary: job.salary,
                    jobDescription: job.jobDescription,
                    datePosted: job.datePosted,
                    degreeRequired: job.degreeRequired,
                    jobType: job.jobType,
                    jobLevel: job.jobLevel,
                });
            } catch {
                // Skip invalid files
            }
        }
    } catch {
        // Dataset directory doesn't exist yet
    }

    return jobs;
}
