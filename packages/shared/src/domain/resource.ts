import type { TokenEvent } from '../token-event';

const TOKEN_TO_FOOD_RATIO = 0.1;
const MINIMUM_FOOD_GAIN = 1;

export type ResourceDelta = {
  food: number;
};

export function tokenEventToResourceDelta(event: TokenEvent): ResourceDelta {
  return {
    food: Math.max(MINIMUM_FOOD_GAIN, Math.floor(event.tokenCount * TOKEN_TO_FOOD_RATIO))
  };
}
