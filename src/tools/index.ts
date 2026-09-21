/** The full tool surface, in the order it is registered. */

import { assemblyTools } from "./assemblies.js";
import { authTools } from "./auth.js";
import { documentTools } from "./documents.js";
import { drawingTools } from "./drawings.js";
import { exportTools } from "./exports.js";
import { featureTools } from "./features.js";
import { featureStudioTools } from "./featurestudio.js";
import { geometryTools } from "./geometry.js";
import { metadataTools } from "./metadata.js";
import { partStudioTools } from "./partstudio.js";
import { requestTools } from "./request.js";
import { sketchTools } from "./sketch.js";
import { variableTools } from "./variables.js";

export const allTools = [
  ...authTools,
  ...documentTools,
  ...partStudioTools,
  ...sketchTools,
  ...featureTools,
  ...geometryTools,
  ...variableTools,
  ...exportTools,
  ...assemblyTools,
  ...drawingTools,
  ...featureStudioTools,
  ...metadataTools,
  ...requestTools,
];

export { ToolContext } from "./context.js";
export type { ToolDef } from "./types.js";
