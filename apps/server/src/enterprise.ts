// The extension point for enterprise features. They are free and open
// source, live in enterprise/, and stay off until an admin switches them on.
// Nothing here imports them: a build passes in the modules it has.
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

export const enterpriseFeatures = ["sso", "scim", "audit", "policies", "admin", "ha"] as const;

export type EnterpriseFeature = (typeof enterpriseFeatures)[number];

/** Which enterprise features are on. */
export type EnterpriseSwitches = Readonly<Record<EnterpriseFeature, boolean>>;

/** An enterprise feature's code: a Fastify plugin the server registers only when the feature is on. */
export interface EnterpriseModule {
  readonly feature: EnterpriseFeature;
  readonly plugin: FastifyPluginAsync;
}

/** The environment variable that switches a feature, such as NETHER_ENTERPRISE_SSO. */
export function switchVariable(feature: EnterpriseFeature): string {
  return `NETHER_ENTERPRISE_${feature.toUpperCase()}`;
}

/**
 * Registers the module of every feature that is on. A feature switched on
 * without a module in this build is an error at startup, not a silent no.
 */
export async function registerEnterprise(
  app: FastifyInstance,
  switches: EnterpriseSwitches,
  modules: readonly EnterpriseModule[],
): Promise<void> {
  for (const feature of enterpriseFeatures) {
    if (!switches[feature]) continue;
    const module = modules.find((item) => item.feature === feature);
    if (module === undefined) {
      throw new Error(
        `${switchVariable(feature)} is on, but this build of Nether has no ${feature} module. ` +
          "Turn it off, or run a build that includes it.",
      );
    }
    await app.register(module.plugin);
  }
}
