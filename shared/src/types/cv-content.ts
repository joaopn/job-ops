import { z } from "zod";

export const cvProfileSchema = z.object({
  network: z.string(),
  username: z.string(),
  url: z.string(),
});

export const cvBasicsSchema = z.object({
  name: z.string(),
  headline: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  profiles: z.array(cvProfileSchema),
});

export const cvExperienceItemSchema = z.object({
  company: z.string(),
  position: z.string(),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  bullets: z.array(z.string()),
});

export const cvEducationItemSchema = z.object({
  institution: z.string(),
  degree: z.string().optional(),
  field: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  bullets: z.array(z.string()).optional(),
});

export const cvProjectItemSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  url: z.string().optional(),
  bullets: z.array(z.string()),
});

export const cvSkillGroupSchema = z.object({
  name: z.string(),
  keywords: z.array(z.string()),
});

export const cvCustomItemSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  date: z.string().optional(),
  description: z.string().optional(),
  bullets: z.array(z.string()).optional(),
});

export const cvCustomSectionSchema = z.object({
  title: z.string(),
  items: z.array(cvCustomItemSchema),
});

export const cvContentSchema = z.object({
  basics: cvBasicsSchema,
  summary: z.string().optional(),
  experience: z.array(cvExperienceItemSchema),
  education: z.array(cvEducationItemSchema),
  projects: z.array(cvProjectItemSchema),
  skillGroups: z.array(cvSkillGroupSchema),
  custom: z.array(cvCustomSectionSchema),
});

export type CvProfile = z.infer<typeof cvProfileSchema>;
export type CvBasics = z.infer<typeof cvBasicsSchema>;
export type CvExperienceItem = z.infer<typeof cvExperienceItemSchema>;
export type CvEducationItem = z.infer<typeof cvEducationItemSchema>;
export type CvProjectItem = z.infer<typeof cvProjectItemSchema>;
export type CvSkillGroup = z.infer<typeof cvSkillGroupSchema>;
export type CvCustomItem = z.infer<typeof cvCustomItemSchema>;
export type CvCustomSection = z.infer<typeof cvCustomSectionSchema>;
export type CvContent = z.infer<typeof cvContentSchema>;
