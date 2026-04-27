import type { CvContent, ResumeProfile } from "@shared/types";

/**
 * Best-effort adapter from the free-form CvContent to the legacy ResumeProfile
 * shape. Phase 4 deletes this together with the ResumeProfile consumers
 * (scorer / ghostwriter context / onboarding); until then it bridges them by
 * reading whatever conventional keys (`basics`, `experience`, etc.) the
 * extracted JSON happens to use and returning empty values when they aren't
 * present.
 */
export function cvContentToResumeProfile(content: CvContent): ResumeProfile {
  const basics = readObject(content.basics);
  const profiles = readArray(basics.profiles).map((entry) => {
    const profile = readObject(entry);
    return {
      network: readString(profile.network),
      username: readString(profile.username),
      url: readString(profile.url),
    };
  });

  const summary = readString(content.summary);
  const skillGroups = readArray(content.skillGroups);
  const projects = readArray(content.projects);
  const experience = readArray(content.experience);

  return {
    basics: {
      name: readString(basics.name),
      headline: readString(basics.headline),
      label: readString(basics.headline),
      email: readString(basics.email),
      phone: readString(basics.phone),
      url: readString(basics.website),
      summary,
      profiles,
    },
    sections: {
      summary: summary ? { content: summary, visible: true } : undefined,
      skills: {
        items: skillGroups.map((entry, index) => {
          const group = readObject(entry);
          return {
            id: `skill-${index}`,
            name: readString(group.name) ?? "",
            description: "",
            level: 0,
            keywords: readArray(group.keywords)
              .map(readString)
              .filter((value): value is string => Boolean(value)),
            visible: true,
          };
        }),
      },
      projects: {
        items: projects.map((entry, index) => {
          const project = readObject(entry);
          const bullets = readArray(project.bullets)
            .map(readString)
            .filter((value): value is string => Boolean(value));
          return {
            id: `project-${index}`,
            name: readString(project.name) ?? "",
            description: readString(project.role) ?? "",
            date: "",
            summary: bullets.join("\n"),
            visible: true,
            url: readString(project.url),
          };
        }),
      },
      experience: {
        items: experience.map((entry, index) => {
          const item = readObject(entry);
          const bullets = readArray(item.bullets)
            .map(readString)
            .filter((value): value is string => Boolean(value));
          return {
            id: `experience-${index}`,
            company: readString(item.company) ?? "",
            position: readString(item.position) ?? "",
            location: readString(item.location) ?? "",
            date: formatDateRange(
              readString(item.startDate),
              readString(item.endDate),
            ),
            summary: bullets.join("\n"),
            visible: true,
          };
        }),
      },
    },
  };
}

function readObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function formatDateRange(start?: string, end?: string): string {
  if (!start && !end) return "";
  if (!start) return end ?? "";
  if (!end) return start;
  return `${start} – ${end}`;
}
