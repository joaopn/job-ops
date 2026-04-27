import { badRequest, conflict, notFound } from "@infra/errors";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import type {
  CvContent,
  CvDocument,
  Job,
  JobChatMessage,
} from "@shared/types";
import * as cvRepo from "../repositories/cv-documents";
import * as jobChatRepo from "../repositories/ghostwriter";
import * as jobsRepo from "../repositories/jobs";
import { applyBriefEdit, applyCvEditOps } from "./cv-edit-ops";
import { getActiveCvDocument } from "./cv-active";
import { generatePdf } from "./pdf";

async function loadAcceptableMessage(input: {
  jobId: string;
  messageId: string;
}): Promise<JobChatMessage> {
  const message = await jobChatRepo.getMessageById(input.messageId);
  if (!message || message.jobId !== input.jobId) {
    throw notFound("Message not found for this job");
  }
  if (!message.proposedEdit) {
    throw badRequest("Message has no proposed edit to act on");
  }
  if (message.editStatus && message.editStatus !== "pending") {
    throw conflict(
      `Edit was already resolved (status: ${message.editStatus})`,
    );
  }
  return message;
}

export type AcceptEditResult =
  | { kind: "cv-edit"; message: JobChatMessage; job: Job }
  | { kind: "brief-edit"; message: JobChatMessage; cv: CvDocument };

export async function acceptEditForJob(input: {
  jobId: string;
  messageId: string;
}): Promise<AcceptEditResult> {
  const message = await loadAcceptableMessage(input);
  const proposed = message.proposedEdit;
  if (!proposed) {
    throw badRequest("Message has no proposed edit to act on");
  }

  if (proposed.kind === "cv-edit") {
    const job = await jobsRepo.getJobById(input.jobId);
    if (!job) throw notFound("Job not found");
    if (!job.tailoredContent) {
      throw badRequest("Job has no tailored content to edit");
    }
    if (!job.cvDocumentId) {
      throw badRequest("Job is not pinned to a CV document");
    }

    const previousContent = job.tailoredContent as CvContent;
    const next = applyCvEditOps(previousContent, proposed.edits);

    await jobsRepo.updateJob(job.id, { tailoredContent: next });

    const pdf = await generatePdf({
      jobId: job.id,
      cvDocumentId: job.cvDocumentId,
      content: next,
    });
    if (!pdf.success) {
      // Roll back the content update so a render failure doesn't desync
      // the persisted tailoredContent from the PDF on disk.
      await jobsRepo.updateJob(job.id, { tailoredContent: previousContent });
      logger.warn("PDF render failed during accept-edit; rolled back", {
        jobId: job.id,
        messageId: message.id,
        reason: sanitizeUnknown(pdf.error),
      });
      throw badRequest(
        `PDF render failed after edit: ${pdf.error ?? "unknown"}`,
      );
    }

    if (pdf.pdfPath !== undefined) {
      await jobsRepo.updateJob(job.id, { pdfPath: pdf.pdfPath });
    }

    const updatedMessage = await jobChatRepo.setMessageEditStatus(
      message.id,
      "accepted",
    );
    const updatedJob = await jobsRepo.getJobById(job.id);
    if (!updatedMessage || !updatedJob) {
      throw new Error("Failed to load message/job after accept-edit");
    }
    return { kind: "cv-edit", message: updatedMessage, job: updatedJob };
  }

  // brief-edit: write through to the active CV document's personal_brief.
  const cv = await getActiveCvDocument();
  if (!cv) throw notFound("No active CV document to edit brief on");

  const nextBrief = applyBriefEdit(cv.personalBrief, proposed);
  const updatedCv = await cvRepo.updateCvDocument(cv.id, {
    personalBrief: nextBrief,
  });
  if (!updatedCv) throw notFound("CV document not found after update");

  const updatedMessage = await jobChatRepo.setMessageEditStatus(
    message.id,
    "accepted",
  );
  if (!updatedMessage) throw notFound("Message not found after status update");

  return { kind: "brief-edit", message: updatedMessage, cv: updatedCv };
}

export async function rejectEditForJob(input: {
  jobId: string;
  messageId: string;
}): Promise<JobChatMessage> {
  const message = await loadAcceptableMessage(input);
  const updated = await jobChatRepo.setMessageEditStatus(
    message.id,
    "rejected",
  );
  if (!updated) throw notFound("Message not found");
  return updated;
}
