/** All four connectors DESIGN.md's invariant 3 refers to — three implemented, one (git-events) is not a cost provider and stays out of this list. Order is display/sync order, not significance. */
import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import { openrouterProvider } from './openrouter';
import type { CostProvider } from './types';

export const ALL_PROVIDERS: CostProvider[] = [anthropicProvider, openaiProvider, openrouterProvider];
