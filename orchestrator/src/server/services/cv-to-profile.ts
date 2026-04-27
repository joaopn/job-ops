import type { CvContent, ResumeProfile } from "@shared/types";

/**
 * Adapts the new CvContent shape to the legacy ResumeProfile shape.
 *
 * ResumeProfile is the RxResume-derived structure that scoring, ghostwriter
 * context, and onboarding still consume. Phase 4 replaces those consumers
 * with code that reads CvContent directly and removes both this adapter and
 * the ResumeProfile type. Until then, this is the single bridge — keep it
 * thin and free of heuristics.
 */
export function cvContentToResumeProfile(content: CvContent): ResumeProfile {
  return {
    basics: {
      name: content.basics.name,
      headline: content.basics.headline,
      label: content.basics.headline,
      email: content.basics.email,
      phone: content.basics.phone,
      url: content.basics.website,
      summary: content.summary,
      profiles: content.basics.profiles.map((p) => ({
        network: p.network,
        username: p.username,
        url: p.url,
      })),
    },
    sections: {
      summary: content.summary
        ? { content: content.summary, visible: true }
        : undefined,
      skills: {
        items: content.skillGroups.map((group, index) => ({
          id: `skill-${index}`,
          name: group.name,
          description: "",
          level: 0,
          keywords: group.keywords,
          visible: true,
        })),
      },
      projects: {
        items: content.projects.map((project, index) => ({
          id: `project-${index}`,
          name: project.name,
          description: project.role ?? "",
          date: "",
          summary: project.bullets.join("\n"),
          visible: true,
          url: project.url,
        })),
      },
      experience: {
        items: content.experience.map((entry, index) => ({
          id: `experience-${index}`,
          company: entry.company,
          position: entry.position,
          location: entry.location ?? "",
          date: formatDateRange(entry.startDate, entry.endDate),
          summary: entry.bullets.join("\n"),
          visible: true,
        })),
      },
    },
  };
}

function formatDateRange(start?: string, end?: string): string {
  if (!start && !end) return "";
  if (!start) return end ?? "";
  if (!end) return start;
  return `${start} – ${end}`;
}
