/** The `assignVariable` feature — the way to define a Part Studio variable when
 *  the variable-table endpoint is unavailable (it 404s on some accounts). */

import { featureCall, pEnum, pQuantity, pString, type Feature } from "./params.js";

export type VariableType = "LENGTH" | "ANGLE" | "NUMBER" | "ANY";

/** Onshape keeps a separate parameter per variable type; writing the wrong one
 *  leaves the variable at zero. */
const VALUE_PARAMETER: Record<VariableType, string> = {
  LENGTH: "lengthValue",
  ANGLE: "angleValue",
  NUMBER: "numberValue",
  ANY: "anyValue",
};

const ANGLE_UNITS = /\b(deg|degree|degrees|rad|radian|radians)\b/i;
const LENGTH_UNITS = /\b(in|inch|inches|ft|foot|feet|yd|mm|cm|m|meter|metre|meters|metres)\b|"/i;

/** Guess the variable type from the expression's units. */
export function inferVariableType(expression: string): VariableType {
  if (ANGLE_UNITS.test(expression)) return "ANGLE";
  if (LENGTH_UNITS.test(expression)) return "LENGTH";
  if (/^\s*-?\d+(\.\d+)?\s*$/.test(expression)) return "NUMBER";
  return "ANY";
}

export function buildAssignVariable(input: {
  name: string;
  expression: string;
  variableType?: VariableType;
  description?: string;
}): Feature {
  const variableType = input.variableType ?? inferVariableType(input.expression);
  const parameters: Feature[] = [
    pEnum("mode", "VariableMode", "ASSIGNED"),
    pEnum("variableType", "VariableType", variableType),
    pString("name", input.name),
    pQuantity(VALUE_PARAMETER[variableType], 0, "", { expression: input.expression }),
  ];
  if (input.description) parameters.push(pString("description", input.description));
  return featureCall("assignVariable", `#${input.name} = ${input.expression}`, parameters);
}
