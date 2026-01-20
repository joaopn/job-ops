/**
 * Service for generating PDF resumes using Reactive Resume API.
 */

import { join } from 'path';
import { writeFile, mkdir, access } from 'fs/promises';
import { existsSync } from 'fs';

import { getSetting } from '../repositories/settings.js';
import { pickProjectIdsForJob } from './projectSelection.js';
import { extractProjectsFromProfile, resolveResumeProjectsSettings } from './resumeProjects.js';
import { getDataDir } from '../config/dataDir.js';
import { getResume, importResume, exportResumePdf, deleteResume } from './rxresume.js';

const OUTPUT_DIR = join(getDataDir(), 'pdfs');

export interface PdfResult {
  success: boolean;
  pdfPath?: string;
  error?: string;
}

export interface TailoredPdfContent {
  summary?: string | null;
  headline?: string | null;
  skills?: any | null;  // Accept any for flexibility, expected to be items array or parsed JSON
}

/**
 * Generate a tailored PDF resume for a job using Reactive Resume API.
 */
export async function generatePdf(
  jobId: string,
  tailoredContent: TailoredPdfContent,
  jobDescription: string,
  _baseResumePath?: string, // Deprecated/ignored when using API
  selectedProjectIds?: string | null
): Promise<PdfResult> {
  console.log(`📄 Generating PDF for job ${jobId} using Reactive Resume API...`);

  let tempResumeId: string | null = null;

  try {
    // 1. Get base resume ID from settings
    const baseResumeId = await getSetting('rxResumeBaseResumeId');
    if (!baseResumeId) {
      throw new Error('rxResumeBaseResumeId not configured in settings. Please select a base resume in settings first.');
    }

    // Ensure output directory exists
    if (!existsSync(OUTPUT_DIR)) {
      await mkdir(OUTPUT_DIR, { recursive: true });
    }

    // 2. Fetch base resume data
    console.log(`   Fetching base resume ${baseResumeId}...`);
    const baseResumeResponse = await getResume(baseResumeId);
    const resumeData = baseResumeResponse.data;

    // 3. Apply tailoring

    // Inject tailored summary
    if (tailoredContent.summary) {
      if (resumeData.sections?.summary) {
        resumeData.sections.summary.content = tailoredContent.summary;
      } else if (resumeData.basics?.summary) {
        resumeData.basics.summary = tailoredContent.summary;
      }
    }

    // Inject tailored headline
    if (tailoredContent.headline) {
      if (resumeData.basics) {
        resumeData.basics.headline = tailoredContent.headline;
        resumeData.basics.label = tailoredContent.headline;
      }
    }

    // Inject tailored skills
    if (tailoredContent.skills) {
      const newSkills = Array.isArray(tailoredContent.skills)
        ? tailoredContent.skills
        : typeof tailoredContent.skills === 'string'
          ? JSON.parse(tailoredContent.skills)
          : null;

      if (newSkills && resumeData.sections?.skills) {
        resumeData.sections.skills.items = newSkills;
      }
    }

    // 4. Select projects and set visibility
    try {
      let selectedSet: Set<string>;

      if (selectedProjectIds) {
        selectedSet = new Set(selectedProjectIds.split(',').map(s => s.trim()).filter(Boolean));
      } else {
        const { catalog, selectionItems } = extractProjectsFromProfile(resumeData);
        const overrideResumeProjectsRaw = await getSetting('resumeProjects');
        const { resumeProjects } = resolveResumeProjectsSettings({ catalog, overrideRaw: overrideResumeProjectsRaw });

        const locked = resumeProjects.lockedProjectIds;
        const desiredCount = Math.max(0, resumeProjects.maxProjects - locked.length);
        const eligibleSet = new Set(resumeProjects.aiSelectableProjectIds);
        const eligibleProjects = selectionItems.filter((p) => eligibleSet.has(p.id));

        const picked = await pickProjectIdsForJob({
          jobDescription,
          eligibleProjects,
          desiredCount,
        });

        selectedSet = new Set([...locked, ...picked]);
      }

      const projectsSection = resumeData.sections?.projects;
      const projectItems = projectsSection?.items;
      if (Array.isArray(projectItems)) {
        for (const item of projectItems) {
          if (!item || typeof item !== 'object') continue;
          const id = typeof (item as any).id === 'string' ? (item as any).id : '';
          if (!id) continue;
          (item as any).visible = selectedSet.has(id);
        }
        projectsSection.visible = selectedSet.size > 0;
      }
    } catch (err) {
      console.warn(`   ⚠️ Project visibility step failed for job ${jobId}:`, err);
    }

    // 5. Import as temporary resume
    console.log(`   Importing temporary resume for job ${jobId}...`);
    const timestamp = new Date().getTime();
    const tempName = `[TEMP] ${resumeData.basics?.name || 'Resume'} - ${jobId.slice(0, 8)} (${timestamp})`;

    tempResumeId = await importResume({
      name: tempName,
      slug: `temp-${jobId}-${timestamp}`,
      data: resumeData,
    });

    if (!tempResumeId) {
      throw new Error('Failed to get ID for imported resume');
    }

    // 6. Export as PDF
    console.log(`   Printing PDF...`);
    const pdfUrl = await exportResumePdf(tempResumeId);

    if (!pdfUrl) {
      throw new Error('Reactive Resume did not return a PDF URL');
    }

    // 7. Download PDF
    const outputFilename = `resume_${jobId}.pdf`;
    const outputPath = join(OUTPUT_DIR, outputFilename);

    console.log(`   Downloading PDF from ${pdfUrl}...`);
    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) {
      throw new Error(`Failed to download PDF (${pdfResponse.status}): ${pdfResponse.statusText}`);
    }

    const buffer = await pdfResponse.arrayBuffer();
    await writeFile(outputPath, Buffer.from(buffer));

    console.log(`✅ PDF generated: ${outputPath}`);

    return { success: true, pdfPath: outputPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ PDF generation failed: ${message}`);
    return { success: false, error: message };
  } finally {
    // 8. Cleanup temp resume
    if (tempResumeId) {
      try {
        console.log(`   Cleaning up temporary resume ${tempResumeId}...`);
        await deleteResume(tempResumeId);
      } catch (cleanupError) {
        console.warn(`   ⚠️ Failed to delete temporary resume ${tempResumeId}:`, cleanupError);
      }
    }
  }
}

/**
 * Check if a PDF exists for a job.
 */
export async function pdfExists(jobId: string): Promise<boolean> {
  const pdfPath = join(OUTPUT_DIR, `resume_${jobId}.pdf`);
  try {
    await access(pdfPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the path to a job's PDF.
 */
export function getPdfPath(jobId: string): string {
  return join(OUTPUT_DIR, `resume_${jobId}.pdf`);
}
