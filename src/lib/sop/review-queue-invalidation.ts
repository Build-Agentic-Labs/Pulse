let mutationGeneration = 0;

export function invalidateSharedReviewQueue(): void {
  mutationGeneration += 1;
}

export function reviewQueueMutationGeneration(): number {
  return mutationGeneration;
}
