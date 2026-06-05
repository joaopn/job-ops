/**
 * A single draggable job card for the Swipe deck. Drag right past the
 * threshold to Select, left to Skip; release short of it springs back.
 */

import { FitAssessment } from "@client/components/FitAssessment";
import { FitIndicator } from "@client/components/ScoreIndicator";
import { JobDescriptionMarkdown } from "@client/components/JobDescriptionMarkdown";
import type { Job } from "@shared/types.js";
import {
  type PanInfo,
  motion,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { Building2, MapPin, Wallet } from "lucide-react";
import type React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";

interface SwipeCardProps {
  job: Job;
  onSelect: () => void;
  onSkip: () => void;
}

const COMMIT_OFFSET = 110; // px past which a release commits the swipe
const COMMIT_VELOCITY = 500; // px/s flick that commits regardless of offset

export const SwipeCard: React.FC<SwipeCardProps> = ({
  job,
  onSelect,
  onSkip,
}) => {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-250, 250], [-12, 12]);
  const selectOpacity = useTransform(x, [20, 130], [0, 1]);
  const skipOpacity = useTransform(x, [-130, -20], [1, 0]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (offset.x > COMMIT_OFFSET || velocity.x > COMMIT_VELOCITY) {
      onSelect();
    } else if (offset.x < -COMMIT_OFFSET || velocity.x < -COMMIT_VELOCITY) {
      onSkip();
    }
  };

  return (
    <motion.div
      className="absolute inset-0"
      style={{ x, rotate, touchAction: "pan-y" }}
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={1}
      onDragEnd={handleDragEnd}
      whileTap={{ cursor: "grabbing" }}
    >
      <Card className="relative flex h-full flex-col overflow-hidden">
        {/* Swipe-direction overlays */}
        <motion.div
          style={{ opacity: selectOpacity }}
          className="pointer-events-none absolute left-4 top-4 z-10 rotate-[-12deg] rounded-md border-2 border-emerald-400 px-3 py-1 text-lg font-extrabold uppercase tracking-wider text-emerald-400"
        >
          Select
        </motion.div>
        <motion.div
          style={{ opacity: skipOpacity }}
          className="pointer-events-none absolute right-4 top-4 z-10 rotate-[12deg] rounded-md border-2 border-rose-400 px-3 py-1 text-lg font-extrabold uppercase tracking-wider text-rose-400"
        >
          Skip
        </motion.div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 [touch-action:pan-y]">
          <div className="space-y-1 text-center">
            <h2 className="text-xl font-semibold leading-tight">{job.title}</h2>
            <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {job.employer}
            </p>
          </div>

          <div className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {job.location}
              </span>
            )}
            {job.salary && (
              <span className="flex items-center gap-1">
                <Wallet className="h-3 w-3" />
                {job.salary}
              </span>
            )}
          </div>

          <div className="flex justify-center">
            <FitIndicator category={job.suitabilityCategory ?? null} />
          </div>

          <FitAssessment job={job} />

          {job.jobDescription && (
            <Accordion type="single" collapsible defaultValue="description">
              <AccordionItem value="description" className="border-b-0">
                <AccordionTrigger className="text-sm">
                  Job description
                </AccordionTrigger>
                <AccordionContent>
                  <JobDescriptionMarkdown description={job.jobDescription} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </div>
      </Card>
    </motion.div>
  );
};
