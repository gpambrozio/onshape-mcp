/** Assembly feature payloads: mates, mate connectors and groups.
 *  Derived from onshape-cli (MIT, see NOTICE).
 *
 * Assembly features use occurrence-aware queries (BTM*WithOccurrence*), which
 * are different from the Part Studio query types. */

import { pEnum, type Feature } from "./params.js";

export function buildAssemblyMate(opts: { name?: string; mateType?: string; mateConnectorIds: string[] }): Feature {
  if (opts.mateConnectorIds.length < 2) {
    throw new Error("A mate needs at least two mate connector feature ids.");
  }
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMMate-64",
      featureType: "mate",
      name: opts.name ?? "Mate",
      suppressed: false,
      parameters: [
        pEnum("mateType", "Mate type", opts.mateType ?? "FASTENED"),
        {
          btType: "BTMParameterQueryWithOccurrenceList-67",
          queries: opts.mateConnectorIds.map((featureId) => ({
            btType: "BTMFeatureQueryWithOccurrence-157",
            path: [],
            featureId,
            queryData: "",
          })),
          parameterId: "mateConnectorsQuery",
        },
      ],
    },
  };
}

/** An implicit mate connector on an instance, placed by inference (CENTROID,
 *  TOP, MID_PLANE, ...) rather than by picking geometry. */
export function buildAssemblyMateConnector(opts: {
  name?: string;
  occurrenceId: string;
  inferenceType?: string;
}): Feature {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMMateConnector-66",
      featureType: "mateConnector",
      name: opts.name ?? "Mate connector",
      suppressed: false,
      parameters: [
        {
          btType: "BTMParameterEnum-145",
          enumName: "Origin type",
          value: "ON_ENTITY",
          parameterId: "originType",
          namespace: "",
        },
        {
          btType: "BTMParameterQueryWithOccurrenceList-67",
          parameterId: "originQuery",
          queries: [
            {
              btType: "BTMInferenceQueryWithOccurrence-1083",
              inferenceType: opts.inferenceType ?? "CENTROID",
              path: [opts.occurrenceId],
              deterministicIds: [],
            },
          ],
        },
      ],
    },
  };
}

/** Lock instances together without individual mates. */
export function buildAssemblyGroup(opts: { name?: string; occurrenceIds: string[] }): Feature {
  if (!opts.occurrenceIds.length) throw new Error("A group needs at least one occurrence id.");
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMMateGroup-65",
      featureType: "mateGroup",
      name: opts.name ?? "Group",
      suppressed: false,
      parameters: [
        {
          btType: "BTMParameterQueryWithOccurrenceList-67",
          queries: opts.occurrenceIds.map((occurrenceId) => ({
            btType: "BTMIndividualOccurrenceQuery-626",
            path: [occurrenceId],
          })),
          parameterId: "occurrencesQuery",
        },
      ],
    },
  };
}
