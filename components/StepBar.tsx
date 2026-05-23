import type { WizardStep } from "@/types";
import { cn } from "@/lib/utils";

const STEPS = [
  { num: 1 as WizardStep, label: "Guide photo" },
  { num: 2 as WizardStep, label: "Votre photo" },
  { num: 3 as WizardStep, label: "Article" },
];

interface StepBarProps {
  currentStep: WizardStep;
}

export function StepBar({ currentStep }: StepBarProps) {
  return (
    <nav aria-label="Étapes de l'essayage" className="flex items-center justify-center gap-2 sm:gap-4">
      {STEPS.map((step, index) => {
        const isActive = currentStep === step.num;
        const isDone = currentStep > step.num;
        return (
          <div key={step.num} className="flex items-center gap-2 sm:gap-4">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "step-indicator",
                  isActive && "step-indicator-active",
                  isDone && "step-indicator-done",
                  !isActive && !isDone && "step-indicator-pending"
                )}
                aria-current={isActive ? "step" : undefined}
              >
                {isDone ? "✓" : step.num}
              </div>
              <span
                className={cn(
                  "hidden text-xs sm:block",
                  isActive ? "font-medium text-bordeaux" : "text-ink-muted"
                )}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  "h-px w-8 sm:w-12",
                  isDone ? "bg-gold" : "bg-ink/10"
                )}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
