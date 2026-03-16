import type { Request } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { DiagramRecord } from './diagram.js';

/** Plan tier for quota enforcement. Self-hosted has no limits. */
export type PlanTier = 'self-hosted' | 'free' | 'pro' | 'team' | 'enterprise';

/** Per-request context resolved by the getContext hook. */
export interface AppContext {
  /** Workspace ID for row-level isolation. Defaults to 'default' for self-hosted. */
  workspaceId: string;
  /** Authenticated user ID, or null for anonymous/self-hosted. */
  userId: string | null;
  /** Current plan tier. Controls quota enforcement in the cloud layer. */
  plan: PlanTier;
  /** Resource limits. Null means unlimited (self-hosted default). */
  limits: {
    maxDiagrams: number | null;
    maxAiMessages: number | null;
    maxVersions: number | null;
  };
}

/** Default context for self-hosted installations. No auth, no limits. */
export const DEFAULT_CONTEXT: AppContext = {
  workspaceId: 'default',
  userId: null,
  plan: 'self-hosted',
  limits: {
    maxDiagrams: null,
    maxAiMessages: null,
    maxVersions: null,
  },
};

/** Lifecycle hooks for the cloud layer. All optional, all no-ops by default. */
export interface LifecycleHooks {
  /** Called after a diagram is created. Use for usage tracking, webhooks, etc. */
  onDiagramCreated?: (ctx: AppContext, diagram: DiagramRecord) => Promise<void>;
  /** Called after a diagram is updated. */
  onDiagramUpdated?: (ctx: AppContext, diagram: DiagramRecord) => Promise<void>;
}

/**
 * Configuration for the Brainflow Express application.
 *
 * Self-hosted: call createApp() with just databaseUrl — all hooks use sensible defaults.
 * Cloud: provide getContext for auth/workspace resolution, lifecycle hooks for tracking.
 */
export interface BrainflowConfig {
  /** PostgreSQL connection string. */
  databaseUrl: string;
  /**
   * Resolve the AppContext for each request.
   * Self-hosted default: returns DEFAULT_CONTEXT (single workspace, no auth, no limits).
   * Cloud: resolve workspace/user from JWT, check subscription tier.
   */
  getContext?: (req: Request) => Promise<AppContext>;
  /** Lifecycle hooks for post-operation processing. */
  hooks?: LifecycleHooks;
  /** CORS origin. Defaults to '*'. */
  corsOrigin?: string;
  /** Pino logger instance. Created automatically if not provided. */
  logger?: Logger;
  /** Connection pool. Created from databaseUrl if not provided. */
  pool?: Pool;
}
