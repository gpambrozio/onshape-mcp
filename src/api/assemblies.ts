/** Assemblies: instances, mates, BOM, transforms.
 *  Derived from onshape-cli (MIT, see NOTICE). */

import {
  buildMateRelation,
  mateReadyForRelations,
  relationDofs,
  type MateDof,
  type MateValueKey,
  type RelationType,
} from "../builders/assembly.js";
import type { OnshapeClient } from "./client.js";
import type { FeatureValidation } from "./partstudio.js";
import { isRecord } from "./util.js";

/** Feature and instance ids in assemblies contain "/" and "+", which must be
 *  escaped in a path segment; unescaped, Onshape answers 404. */
const segment = (id: string) => encodeURIComponent(id);

/** One mate's values as Onshape reports them: metres and radians. */
export type MateValue = Record<string, unknown> & { featureId: string; jsonType: string };

export interface MateValueUpdate {
  featureId: string;
  /** Metres and radians, keyed by Onshape's degree-of-freedom name. */
  values: Partial<Record<MateValueKey, number>>;
}

export class AssemblyManager {
  constructor(private readonly client: OnshapeClient) {}

  async createAssembly(documentId: string, workspaceId: string, name: string): Promise<unknown> {
    return this.client.post(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}`, { name });
  }

  async getFeatures(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/features`);
  }

  async getBom(
    documentId: string,
    workspaceId: string,
    elementId: string,
    opts: { indented?: boolean; multiLevel?: boolean; generateIfAbsent?: boolean } = {},
  ): Promise<unknown> {
    return this.client.get(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/bom`, {
      indented: String(opts.indented ?? true),
      multiLevel: String(opts.multiLevel ?? false),
      generateIfAbsent: String(opts.generateIfAbsent ?? true),
    });
  }

  async massProperties(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/massproperties`);
  }

  async insertInstance(
    documentId: string,
    workspaceId: string,
    elementId: string,
    opts: {
      sourceDocumentId: string;
      sourceElementId: string;
      partId?: string;
      sourceVersionId?: string;
      isAssembly?: boolean;
      isWholePartStudio?: boolean;
      configuration?: string;
      isFixed?: boolean;
    },
  ): Promise<unknown> {
    const body: Record<string, unknown> = { documentId: opts.sourceDocumentId, elementId: opts.sourceElementId };
    if (opts.sourceVersionId) body.versionId = opts.sourceVersionId;
    if (opts.partId) {
      body.partId = opts.partId;
      body.includePartTypes = ["PARTS"];
    }
    if (opts.isAssembly) body.isAssembly = true;
    if (opts.isWholePartStudio) body.isWholePartStudio = true;
    if (opts.configuration) body.configuration = opts.configuration;
    // Onshape has no public endpoint to fix an instance after insertion, so
    // this is the only place the API can ground one.
    if (opts.isFixed) body.isFixed = true;
    return this.client.post(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/instances`, body);
  }

  async addFeature(documentId: string, workspaceId: string, elementId: string, feature: unknown): Promise<unknown> {
    return this.client.post(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/features`, feature);
  }

  async updateFeature(
    documentId: string,
    workspaceId: string,
    elementId: string,
    featureId: string,
    feature: unknown,
  ): Promise<unknown> {
    return this.client.post(
      `/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/features/featureid/${segment(featureId)}`,
      feature,
    );
  }

  async deleteFeature(documentId: string, workspaceId: string, elementId: string, featureId: string): Promise<unknown> {
    return this.client.delete(
      `/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/features/featureid/${segment(featureId)}`,
    );
  }

  /** As in Part Studios, Onshape answers 200 for an assembly feature that
   *  regenerates with ERROR; only the feature states tell. */
  async validateFeature(
    documentId: string,
    workspaceId: string,
    elementId: string,
    featureId: string,
  ): Promise<FeatureValidation> {
    const features = await this.getFeatures(documentId, workspaceId, elementId);
    const states = isRecord(features) && isRecord(features.featureStates) ? features.featureStates : {};
    const state = isRecord(states[featureId]) ? states[featureId] : {};
    const status = typeof state.featureStatus === "string" ? state.featureStatus : null;
    if (status === "ERROR") throw new Error(`Assembly feature ${featureId} regenerated with status ERROR.`);
    return { featureId, featureStatus: status };
  }

  /** Couple two mates (one, for a screw) with a gear, rack-and-pinion, screw
   *  or linear relation. Each mate's degree of freedom comes from its type
   *  unless `dofs` says otherwise, and a mate lacking the parameter relations
   *  need is completed first; see mateReadyForRelations. */
  async addMateRelation(
    documentId: string,
    workspaceId: string,
    elementId: string,
    opts: {
      relationType: RelationType;
      mateIds: string[];
      dofs?: MateDof[];
      ratio?: number;
      distancePerRevolution?: number;
      reverse?: boolean;
      name?: string;
    },
  ): Promise<Record<string, unknown>> {
    const listing = await this.getFeatures(documentId, workspaceId, elementId);
    const features: unknown[] = isRecord(listing) && Array.isArray(listing.features) ? listing.features : [];
    const mates = opts.mateIds.map((mateId) => {
      const mate = features.find((feature) => isRecord(feature) && feature.featureId === mateId);
      if (!isRecord(mate) || mate.featureType !== "mate") {
        throw new Error(`No mate with feature id ${mateId} in this assembly; see onshape_get_assembly_features.`);
      }
      return mate;
    });
    const mateTypes = mates.map((mate) => {
      const parameters: unknown[] = Array.isArray(mate.parameters) ? mate.parameters : [];
      const type = parameters.find((param) => isRecord(param) && param.parameterId === "mateType");
      return isRecord(type) ? String(type.value) : "UNKNOWN";
    });
    let dofs = opts.dofs;
    if (dofs) {
      if (dofs.length !== mates.length) throw new Error(`Give one dof per mate (${mates.length}), got ${dofs.length}.`);
    } else {
      dofs = relationDofs(opts.relationType, mateTypes);
    }

    const completedMates: string[] = [];
    for (const mate of mates) {
      const ready = mateReadyForRelations(mate);
      if (!ready) continue;
      await this.updateFeature(documentId, workspaceId, elementId, String(mate.featureId), ready);
      completedMates.push(String(mate.featureId));
    }

    const feature = buildMateRelation({
      name: opts.name,
      relationType: opts.relationType,
      mates: mates.map((mate, index) => ({ featureId: String(mate.featureId), dof: (dofs as MateDof[])[index] })),
      ratio: opts.ratio,
      distancePerRevolution: opts.distancePerRevolution,
      reverse: opts.reverse,
    });
    const response = await this.addFeature(documentId, workspaceId, elementId, feature);
    const featureId =
      isRecord(response) && isRecord(response.feature) && typeof response.feature.featureId === "string"
        ? response.feature.featureId
        : null;
    if (!featureId) throw new Error(`Onshape returned no feature id for the relation: ${JSON.stringify(response)}`);
    const validation = await this.validateFeature(documentId, workspaceId, elementId, featureId);
    return { featureId, mateTypes, dofs, completedMates, validation, response };
  }

  /** Every mate's current values, in metres and radians. Version 10 or later:
   *  older versions read the same but silently ignore writes. */
  async getMateValues(documentId: string, workspaceId: string, elementId: string): Promise<MateValue[]> {
    const response = await this.client.get(
      `/api/v10/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/matevalues`,
    );
    const values = isRecord(response) && Array.isArray(response.mateValues) ? response.mateValues : [];
    return values.filter((value): value is MateValue => isRecord(value) && typeof value.featureId === "string");
  }

  /** Drive mates to new values, then read them back. Onshape accepts a write
   *  it does not apply (a degree of freedom the mate lacks, a mate with limits
   *  enabled, a value the other mates cannot reach) and still answers 200, so
   *  a value that did not stick is an error here. */
  async setMateValues(
    documentId: string,
    workspaceId: string,
    elementId: string,
    updates: MateValueUpdate[],
  ): Promise<MateValue[]> {
    const current = await this.getMateValues(documentId, workspaceId, elementId);
    // Only top-level mates: a mate inside a sub-assembly has its own owner path.
    const topLevel = (featureId: string) =>
      current.find(
        (value) =>
          value.featureId === featureId &&
          (!Array.isArray(value.ownerOccurrencePath) || value.ownerOccurrencePath.length === 0),
      );

    const mateValues = updates.map((update) => {
      const existing = topLevel(update.featureId);
      if (!existing) {
        const known = current.map((value) => `${value.featureId} (${String(value.mateName)})`).join(", ");
        throw new Error(`No top-level mate ${update.featureId} with values in this assembly. Mates: ${known || "none"}.`);
      }
      for (const key of Object.keys(update.values)) {
        if (!(key in existing)) {
          const has = Object.keys(existing).filter((name) => /^(translation|rotation)[XYZ]$/.test(name));
          throw new Error(
            `Mate ${update.featureId} (${existing.jsonType}) has no ${key}; it has ${has.join(", ") || "no free values"}.`,
          );
        }
      }
      return { ...existing, ...update.values, ownerOccurrencePath: [] };
    });

    await this.client.post(`/api/v10/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/matevalues`, {
      mateValues,
    });

    const after = await this.getMateValues(documentId, workspaceId, elementId);
    const ignored: string[] = [];
    for (const update of updates) {
      const read = after.find((value) => value.featureId === update.featureId);
      for (const [key, wanted] of Object.entries(update.values) as Array<[MateValueKey, number]>) {
        const got = Number(read?.[key]);
        if (!sameMateValue(key, wanted, got)) ignored.push(`${update.featureId} ${key}: asked ${wanted}, reads ${got}`);
      }
    }
    if (ignored.length) {
      throw new Error(
        `Onshape accepted the mate values but did not apply them (metres/radians): ${ignored.join("; ")}. ` +
          "Mates with limits enabled refuse API writes; so do values the other mates or relations cannot reach.",
      );
    }
    return after;
  }

  async deleteInstance(documentId: string, workspaceId: string, elementId: string, nodeId: string): Promise<unknown> {
    return this.client.delete(
      `/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/instance/nodeid/${segment(nodeId)}`,
    );
  }

  /** Apply a 16-float row-major 4x4 transform to occurrence paths (POST, not PATCH). */
  async transformOccurrences(
    documentId: string,
    workspaceId: string,
    elementId: string,
    occurrencePaths: string[][],
    transform: number[],
    opts: { isRelative?: boolean } = {},
  ): Promise<unknown> {
    return this.client.post(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/occurrencetransforms`, {
      isRelative: opts.isRelative ?? true,
      occurrences: occurrencePaths.map((path) => ({ path })),
      transform,
    });
  }
}

/** Angles compare modulo a full turn: Onshape may report 270 degrees as -90. */
function sameMateValue(key: MateValueKey, wanted: number, got: number): boolean {
  if (!Number.isFinite(got)) return false;
  if (key.startsWith("translation")) return Math.abs(wanted - got) < 1e-7;
  const turn = 2 * Math.PI;
  const difference = (((wanted - got) % turn) + turn) % turn;
  return Math.min(difference, turn - difference) < 1e-6;
}
