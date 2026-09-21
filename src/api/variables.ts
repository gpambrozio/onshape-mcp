/** Part Studio variables.
 *
 * Onshape exposes a variable-table endpoint, but it answers 404 on some
 * accounts (free plans, and Part Studios whose variables live in features).
 * Both operations therefore fall back to the `assignVariable` feature, which
 * works everywhere and is what the Onshape UI itself creates.
 *
 * Derived from onshape-cli (MIT, see NOTICE); the feature fallback is new. */

import { buildAssignVariable, type VariableType } from "../builders/variables.js";
import { HttpError, type OnshapeClient } from "./client.js";
import { isRecord } from "./util.js";

export interface VariableRecord {
  name: string;
  expression: string;
  description: string | null;
  featureId?: string;
}

export interface VariableListing {
  variables: VariableRecord[];
  source: "variable-table" | "assign-variable-feature";
}

export interface VariableWrite {
  name: string;
  expression: string;
  route: "variable-table" | "assign-variable-feature";
  featureId?: string;
  response: unknown;
}

const VALUE_PARAMETERS = new Set(["lengthValue", "angleValue", "numberValue", "anyValue"]);

export class VariableManager {
  constructor(private readonly client: OnshapeClient) {}

  async getVariables(documentId: string, workspaceId: string, elementId: string): Promise<VariableListing> {
    try {
      const response = await this.client.get(
        `/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/variables`,
      );
      const items = Array.isArray(response) ? response : [];
      return {
        source: "variable-table",
        variables: items.map((item) => ({
          name: isRecord(item) ? String(item.name ?? "") : "",
          expression: isRecord(item) ? String(item.expression ?? "") : "",
          description: isRecord(item) && item.description ? String(item.description) : null,
        })),
      };
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return { source: "assign-variable-feature", variables: await this.variablesFromFeatures(documentId, workspaceId, elementId) };
    }
  }

  async setVariable(
    documentId: string,
    workspaceId: string,
    elementId: string,
    name: string,
    expression: string,
    description?: string,
    variableType?: VariableType,
  ): Promise<VariableWrite> {
    const body: Record<string, unknown> = { name, expression };
    if (description) body.description = description;

    try {
      const response = await this.client.post(
        `/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/variables`,
        body,
      );
      return { name, expression, route: "variable-table", response };
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const feature = buildAssignVariable({ name, expression, description, variableType });
      const response = await this.client.post(
        `/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features`,
        feature,
      );
      const featureId =
        isRecord(response) && isRecord(response.feature) && typeof response.feature.featureId === "string"
          ? response.feature.featureId
          : undefined;
      return { name, expression, route: "assign-variable-feature", featureId, response };
    }
  }

  /** Read variables back out of the feature tree when the table is unavailable. */
  private async variablesFromFeatures(
    documentId: string,
    workspaceId: string,
    elementId: string,
  ): Promise<VariableRecord[]> {
    const features = await this.client.get(
      `/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features`,
    );
    const list = isRecord(features) && Array.isArray(features.features) ? features.features : [];
    const variables: VariableRecord[] = [];

    for (const feature of list) {
      if (!isRecord(feature) || feature.featureType !== "assignVariable") continue;
      const parameters = Array.isArray(feature.parameters) ? feature.parameters : [];
      let name = "";
      let expression = "";
      let description: string | null = null;

      for (const parameter of parameters) {
        if (!isRecord(parameter)) continue;
        if (parameter.parameterId === "name") name = String(parameter.value ?? "");
        else if (parameter.parameterId === "description" && parameter.value) description = String(parameter.value);
        else if (VALUE_PARAMETERS.has(String(parameter.parameterId)) && parameter.expression) {
          const candidate = String(parameter.expression);
          // A Variable feature carries a parameter per type; the ones it is not
          // using are left at their zero defaults.
          if (!isZeroDefault(candidate)) expression = candidate;
        }
      }
      if (name) variables.push({ name, expression, description, featureId: String(feature.featureId ?? "") });
    }
    return variables;
  }
}

function isZeroDefault(expression: string): boolean {
  return /^\s*(0(\s*[a-z]+)?|"\?")\s*$/i.test(expression);
}

function isNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}
