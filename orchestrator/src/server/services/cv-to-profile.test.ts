// @vitest-environment node
import type { CvContent } from "@shared/types";
import { describe, expect, it } from "vitest";
import { cvContentToResumeProfile } from "./cv-to-profile";

const FULL_CONTENT: CvContent = {
  basics: {
    name: "Ada Lovelace",
    headline: "Computing pioneer",
    email: "ada@example.test",
    phone: "+44 0",
    location: "London",
    website: "https://ada.test",
    profiles: [
      { network: "GitHub", username: "ada", url: "https://github.com/ada" },
    ],
  },
  summary: "Mathematician and writer.",
  experience: [
    {
      company: "Analytical Engine Co.",
      position: "Programmer",
      location: "London",
      startDate: "1843",
      endDate: "Present",
      bullets: ["Wrote the first algorithm.", "Authored Notes."],
    },
  ],
  education: [],
  projects: [
    {
      name: "Notes on the Engine",
      role: "Author",
      url: "https://example.test/notes",
      bullets: ["Translated and annotated Menabrea's lecture."],
    },
  ],
  skillGroups: [
    { name: "Mathematics", keywords: ["algebra", "calculus"] },
  ],
  custom: [],
};

describe("cvContentToResumeProfile", () => {
  it("maps basics, summary, experience, projects, and skills", () => {
    const profile = cvContentToResumeProfile(FULL_CONTENT);
    expect(profile.basics?.name).toBe("Ada Lovelace");
    expect(profile.basics?.headline).toBe("Computing pioneer");
    expect(profile.basics?.label).toBe("Computing pioneer");
    expect(profile.basics?.email).toBe("ada@example.test");
    expect(profile.basics?.url).toBe("https://ada.test");
    expect(profile.basics?.profiles?.[0]).toMatchObject({
      network: "GitHub",
      username: "ada",
    });

    expect(profile.sections?.summary?.content).toBe(
      "Mathematician and writer.",
    );
    expect(profile.sections?.experience?.items?.[0]).toMatchObject({
      company: "Analytical Engine Co.",
      position: "Programmer",
      date: "1843 – Present",
    });
    expect(profile.sections?.experience?.items?.[0]?.summary).toContain(
      "Wrote the first algorithm.",
    );
    expect(profile.sections?.projects?.items?.[0]).toMatchObject({
      name: "Notes on the Engine",
      description: "Author",
    });
    expect(profile.sections?.skills?.items?.[0]).toMatchObject({
      name: "Mathematics",
      keywords: ["algebra", "calculus"],
    });
  });

  it("formats partial date ranges", () => {
    const profile = cvContentToResumeProfile({
      ...FULL_CONTENT,
      experience: [
        {
          company: "Solo",
          position: "Founder",
          startDate: "2020",
          bullets: [],
        },
      ],
    });
    expect(profile.sections?.experience?.items?.[0]?.date).toBe("2020");
  });

  it("returns empty arrays for empty CvContent sections", () => {
    const profile = cvContentToResumeProfile({
      basics: { name: "Empty", profiles: [] },
      experience: [],
      education: [],
      projects: [],
      skillGroups: [],
      custom: [],
    });
    expect(profile.sections?.experience?.items).toEqual([]);
    expect(profile.sections?.projects?.items).toEqual([]);
    expect(profile.sections?.skills?.items).toEqual([]);
    expect(profile.sections?.summary).toBeUndefined();
  });
});
