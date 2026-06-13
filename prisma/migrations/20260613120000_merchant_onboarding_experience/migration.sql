-- AlterTable
ALTER TABLE "AppState"
ADD COLUMN     "onboardingFirstRuleAt" TIMESTAMP(3),
ADD COLUMN     "onboardingFirstPreviewAt" TIMESTAMP(3),
ADD COLUMN     "onboardingFirstApplyStartAt" TIMESTAMP(3),
ADD COLUMN     "onboardingFirstApplyAt" TIMESTAMP(3),
ADD COLUMN     "onboardingFirstScheduleAt" TIMESTAMP(3),
ADD COLUMN     "onboardingCelebratedAt" TIMESTAMP(3),
ADD COLUMN     "reviewRequestShownAt" TIMESTAMP(3),
ADD COLUMN     "reviewRequestDismissedAt" TIMESTAMP(3);

