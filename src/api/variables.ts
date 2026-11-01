/** Part Studio variables.
 *
 * Onshape exposes a variable-table endpoint, but it answers 404 on some
 * accounts (free plans, and Part Studios whose variables live in features).
 * Both operations therefore fall back to the `assignVariable` feature, which
 * works everywhere and is what the Onshape UI itself creates.
 *
 * Derived from onshape-cli (MIT, see NOTICE); the feature fallback is new. */

import { buildAssignVariable, VALUE_PARAMETER, type VariableType } from "../builders/variables.js";
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
  /** On the feature route: whether an existing Variable feature was rewritten
   *  in place or a new one appended to the end of the tree. */
  action?: "updated" | "created";
  featureId?: string;
  /** Every Variable feature written, when more than one assigned the name. */
  featureIds?: string[];
  response: unknown;
}

const VALUE_PARAMETERS = new Set<string>(Object.values(VALUE_PARAMETER));

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
      return this.setVariableFeature(documentId, workspaceId, elementId, name, expression, description, variableType);
    }
  }

  /** Features only see variables assigned above them in the tree, so a second
   *  Variable feature appended at the end would leave everything built so far on
   *  the old value. Rewrite the existing assignments instead, and append only
   *  when the name is new. */
  private async setVariableFeature(
    documentId: string,
    workspaceId: string,
    elementId: string,
    name: string,
    expression: string,
    description?: string,
    variableType?: VariableType,
  ): Promise<VariableWrite> {
    const base = `/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features`;
    const existing = (await this.variablesFromFeatures(documentId, workspaceId, elementId)).filter(
      (variable) => variable.name === name && variable.featureId,
    );

    if (!existing.length) {
      const response = await this.client.post(base, buildAssignVariable({ name, expression, description, variableType }));
      const featureId =
        isRecord(response) && isRecord(response.feature) && typeof response.feature.featureId === "string"
          ? response.feature.featureId
          : undefined;
      return { name, expression, route: "assign-variable-feature", action: "created", featureId, response };
    }

    // Every assignment of the name is rewritten: leaving an earlier one alone
    // would keep the features between it and the next on the old value.
    const responses: unknown[] = [];
    for (const variable of existing) {
      const featureId = variable.featureId as string;
      const feature = buildAssignVariable({
        name,
        expression,
        // Keep the description the feature already has unless a new one is given.
        description: description ?? variable.description ?? undefined,
        variableType,
      });
      // The update endpoint matches the payload to the feature by id.
      (feature.feature as Record<string, unknown>).featureId = featureId;
      responses.push(await this.client.post(`${base}/featureid/${featureId}`, feature));
    }
    const featureIds = existing.map((variable) => variable.featureId as string);
    return {
      name,
      expression,
      route: "assign-variable-feature",
      action: "updated",
      featureId: featureIds[0],
      ...(featureIds.length > 1 ? { featureIds } : {}),
      response: responses.length === 1 ? responses[0] : responses,
    };
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
      let variableType = "";
      let description: string | null = null;
      const expressions = new Map<string, string>();

      for (const parameter of parameters) {
        if (!isRecord(parameter)) continue;
        const id = String(parameter.parameterId);
        if (id === "name") name = String(parameter.value ?? "");
        else if (id === "variableType") variableType = String(parameter.value ?? "");
        else if (id === "description" && parameter.value) description = String(parameter.value);
        else if ((VALUE_PARAMETERS.has(id) || id === "value") && parameter.expression) {
          expressions.set(id, String(parameter.expression));
        }
      }
      const expression = variableExpression(variableType, expressions);
      if (name) variables.push({ name, expression, description, featureId: String(feature.featureId ?? "") });
    }
    return variables;
  }
}

/** A Variable feature written by the Onshape dialog carries a parameter for
 *  every type, the unused ones at defaults such as `0.0*deg`, and its `value`
 *  may be stale. The slot named by `variableType` is the one Onshape evaluates. */
function variableExpression(variableType: string, expressions: Map<string, string>): string {
  const slot = VALUE_PARAMETER[variableType as VariableType];
  const typed = slot ? expressions.get(slot) : undefined;
  if (typed) return typed;
  const value = expressions.get("value");
  if (value) return value;
  // No type to go by: take a typed slot that is not left at its zero default.
  for (const [id, candidate] of expressions) {
    if (VALUE_PARAMETERS.has(id) && !isZeroDefault(candidate)) return candidate;
  }
  return "";
}

function isZeroDefault(expression: string): boolean {
  return /^\s*(0(\s*[a-z]+)?|"\?")\s*$/i.test(expression);
}

function isNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}
